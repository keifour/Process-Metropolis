# Process Metropolis · 数字生态大都会

使用 Node.js 与 Three.js，将真实系统进程映射为可交互的 3D 城市。

## Windows 桌面版

在 [Releases](https://github.com/keifour/Process-Metropolis/releases) 下载 `Process-Metropolis-0.2.0-windows-x64.exe`，双击运行，无需 Node.js 或 WSL。支持 Windows 10/11 x64。免安装程序首次启动会解压内置运行时；退出窗口即停止监控服务。

原生采样通过随程序附带的 .NET/Win32 辅助程序完成，不依赖 PowerShell 或 WMI。源码开发会自动使用 Windows 自带的 .NET Framework 4 编译器构建该辅助程序。无需管理员权限；仅允许结束当前用户、当前会话中的非关键进程，结束前会再次校验身份及权限。程序未进行商业代码签名，Windows 可能提示未知发布者。下载校验值见 Release 中的 `SHA256SUMS.txt`。

## 本机源码运行

需要 Node.js 22 或更新版本，支持 Windows、Linux 与 macOS。

```sh
npm ci
npm start
```

在运行服务的电脑打开 http://127.0.0.1:3000 。可通过 `PORT=3001 npm start` 更换端口。服务仅监听本机回环地址，不应通过公网反向代理暴露。

```sh
npm test
npm run desktop
```

在 Windows 上构建免安装 EXE：

```sh
npm ci
npm run dist:win
```

产物在 `dist/`。GitHub Actions 在 Windows 环境执行测试、构建，并实际启动打包目录及最终 EXE 以检查进程采样和 WebGL。推送与包版本一致的 `v*` 标签后，只有以上检查全部成功才会上传并发布 Release。发布回执和日志同时保存在 `release-reports/<分支或标签>` 分支。

## 已实现

- 每两秒采集真实 PID、进程名称、CPU 和常驻内存，搜索与排序。
- 最多显示内存最高的 100 座建筑；侧栏显示全部进程。高度映射内存，颜色响应 CPU；拖动旋转、滚轮缩放、点击检查。
- 总 CPU 高负载触发地面震动，系统内存占用超过 85% 增加城市雾效。
- 进程退出时触发碎片拆除动画。确认后可强制结束同用户进程（Unix SIGKILL / Windows 原生终止）。
- 结束前重新检查进程启动身份及权限；保护 PID 1、服务本身及其父进程链，禁止结束 root 进程；Windows 另保护关键系统进程、系统会话和其他用户进程，桌面端同时保护自身子进程。校验 Host、Origin 和会话令牌。

## 指标与限制

监控的是 **Node.js 所在机器**，云端运行时无法读取访客电脑进程。Linux CPU 使用相邻采样的进程时间差（单核 100%，多线程可超过 100%）；Windows 使用相邻采样的 .NET 累计进程时间差，首次采样 CPU 为 0；Linux 首次采样及 macOS 使用 `ps` 的 CPU 指标。顶部按逻辑核数归一化。物理内存为系统 `total - free`，包含可回收缓存，不能据此确诊内存泄漏；雾效仅表示内存压力。

强制结束可能丢失未保存内容，不会自动选择或结束进程。无法完全消除操作系统 PID 复用与检查后的极短竞争窗口。容器中只看到容器可见的进程。点状虚拟市民沿街道行走，拆除时会加速逃散；当前不包含历史趋势、泄漏诊断和后台守护进程角色模型。建筑数量上限用于控制绘制开销。

Three.js 从本地依赖加载；字体有系统字体回退。没有外部 API、数据库或密钥要求。

桌面应用包含 Electron 运行时，界面关闭后自动结束本机回环服务。运行时只允许访问应用自身的本机地址，不加载外部网页，不开放 Node.js 给界面。
