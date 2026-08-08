@echo off
REM ============================================================
REM  Aurora Music 启动脚本（无需打包 exe 也可直接运行）
REM  双击此文件即可启动 Aurora Music 播放器
REM ============================================================
chcp 65001 >nul
title Aurora Music - 毛玻璃音乐播放器 + 游戏混音

cd /d "%~dp0"
echo [Aurora Music] 正在启动...
echo.

REM 先做一次构建（如果 out/ 目录不存在）
if not exist "out\main\index.js" (
    echo [Aurora Music] 首次运行，正在构建...
    call npm.cmd run build
    if errorlevel 1 (
        echo [错误] 构建失败！请确认 npm install 已安装依赖
        pause
        exit /b 1
    )
    echo [Aurora Music] 构建完成。
    echo.
)

echo [Aurora Music] 启动 Electron...
call npx.cmd electron out/main/index.js
if errorlevel 1 (
    echo.
    echo [提示] 如果提示 electron 找不到，请执行：
    echo          npm.cmd install
    pause
)
