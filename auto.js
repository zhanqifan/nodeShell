const path = require('path');
const fs = require('fs');
const Client = require('ssh2-sftp-client');
const sftpConfig = require('./sftp.js');
const ora = require('ora');
const dayjs =require('dayjs')
let spinner = null; // 加载实例

const config = {
  host: '38.55.232.204',
  port: '22',
  username: 'root',
  password: 'qoshCGJN6191',
};

let totalFileCount = 0; // 本地dist文件夹中总文件数量
let num = 0; // 已成功上传到远端服务器上的文件数量



// 统计本地dist文件夹中有多少个文件（用于计算文件上传进度）
function foldFileCount(folderPath) {
  let count = 0;
  const files = fs.readdirSync(folderPath); // 读取文件夹
  for (const file of files) { // 遍历
    const filePath = path.join(folderPath, file);
    const stats = fs.statSync(filePath);
    if (stats.isFile()) { // 文件就+1
      count = count + 1;
    } else if (stats.isDirectory()) { // 文件夹就递归加
      count = count + foldFileCount(filePath);
    }
  }
  return count;
}

// 把本地打包好的dist递归上传到远端服务器
async function uploadFilesToRemote(localFolderPath, remoteFolderPath, sftp) {
  const files = fs.readdirSync(localFolderPath); // 读取文件夹
  for (const file of files) { // 遍历
    let localFilePath = path.join(localFolderPath, file); // 拼接本地路径
    let remoteFilePath = path.join(remoteFolderPath, file); // 拼接远程路径
    remoteFilePath = remoteFilePath.replace(/\\/g, '/'); // 针对于lunix服务器，需要做正反斜杠的转换
    const stats = fs.statSync(localFilePath); // 获取文件夹文件信息
    if (stats.isFile()) { // 是文件
      await sftp.put(localFilePath, remoteFilePath); // 把文件丢到远端服务器
      num = num + 1; // 完成数量加1
      let progress = ((num / totalFileCount) * 100).toFixed(2) + '%'; // 算一下进度
      spinner.text = '当前上传进度为:' + progress+'\n'; // loading
    } else if (stats.isDirectory()) { // 是文件夹
      await sftp.mkdir(remoteFilePath, true); // 给远端服务器创建文件夹
      await uploadFilesToRemote(localFilePath, remoteFilePath, sftp); // 递归调用
    }
  }
}

// 备份远程文件
async function BackUpFile(sftp, remoteBackPath, remoteFolderPath) {
  const dateFolder = day.js().format('YYYY-MM-DD');
  const remoteDateBackPath = path.join(remoteBackPath, dateFolder).replace(/\\/g, '/'); // 备份文件下的日期文件夹
  console.log(remoteDateBackPath);
  // 检查备份文件夹是否存在，如果不存在则创建
  const backupFolderExists = await sftp.exists(remoteBackPath);
  if (!backupFolderExists) {
    await sftp.mkdir(remoteBackPath, true); // 创建备份文件夹
    console.log('备份文件夹创建成功');
  }

  // 检查带日期的备份文件夹是否存在，如果不存在则创建
  const dateBackupFolderExists = await sftp.exists(remoteDateBackPath);
  if (!dateBackupFolderExists) {
    await sftp.mkdir(remoteDateBackPath, true); // 创建带日期的备份文件夹
    console.log(`备份文件夹 ${remoteDateBackPath} 创建成功`);
  }

  // 检查主文件夹是否存在
  const remoteFolderExists = await sftp.exists(remoteFolderPath);
  if (!remoteFolderExists) {
    await sftp.mkdir(remoteFolderPath, true); // 创建主文件夹
    console.log(`主文件夹 ${remoteFolderPath} 创建成功`);
  } else {
    // 获取主文件夹中的所有文件
    const files = await sftp.list(remoteFolderPath);
    for (const file of files) {
      if (file.name === '.deployed_flag') {
        // 跳过 .deployed_flag 文件
        console.log(`跳过备份文件 ${file.name}`);
        continue;
      }
      const remoteFilePath = path.join(remoteFolderPath, file.name).replace(/\\/g, '/'); // 针对于linux服务器做文件路径转换
      let backupFilePath = path.join(remoteDateBackPath, file.name).replace(/\\/g, '/'); // 备份文件夹下的日期文件夹路径
      const backupFileExists = await sftp.exists(backupFilePath);
      if (backupFileExists) {
        const timestamp = dayjs().format('HHmmss'); // 添加时间戳
        backupFilePath = path.join(remoteDateBackPath, `${file.name}_${timestamp}`).replace(/\\/g, '/');
        console.log(`备份文件 ${file.name} 已存在，重命名为 ${backupFilePath}`);
      }
      // 备份文件到备份日期文件夹
      await sftp.rename(remoteFilePath, backupFilePath);
      console.log(`文件 ${file.name} 已备份`);
    }
  }
}

// 检查是否已部署过
async function checkIfDeployed(sftp, flagFilePath) {
  return sftp.exists(flagFilePath);
}

// 主程序
async function main() {
  const localFolderPath = sftpConfig.localFolderPath; // 本地打包文件夹路径
  const remoteFolderPath = sftpConfig.remoteFolderPath; // 远程liunx的部署文件夹路径
  const remoteBackPath = sftpConfig.remoteBackPath;//远程liunx的备份文件夹路径
  const flagFilePath = path.join(remoteFolderPath, '.deployed_flag').replace(/\\/g, '/'); // 标记文件路径
  totalFileCount = foldFileCount(localFolderPath); // 统计打包好的部署文件夹中文件的数量
  if (!totalFileCount) return console.log('dist文件为空'); // 本地打包好的dist文件夹是空文件夹就不操作
  const sftp = new Client(); // 实例化sftp可调用其方法
  try {
    console.log('连接服务器');
    await sftp.connect(config);
    console.log('服务器连接成功');
    
    const deployed = await checkIfDeployed(sftp, flagFilePath);
    if (deployed) {
      console.log('检测到已部署标记，进行备份');
      await BackUpFile(sftp, remoteBackPath, remoteFolderPath);
    }else{
      await sftp.mkdir(sftpConfig.remoteFolderPath)
    }

    spinner = ora('自动化脚本执行开始').start(); // loading...
    await uploadFilesToRemote(localFolderPath, remoteFolderPath, sftp); // 递归上传文件

    // 设置部署标记
    await sftp.put(Buffer.from('deployed'), flagFilePath);
    console.log('部署标记已设置 后续部署进行会备份');

  } catch (err) {
    console.log(err,'脚本执行错误');
  } finally {
    sftp.end();
    spinner.info('自动化脚本执行结束');
  }
}

// 执行脚本
main();
