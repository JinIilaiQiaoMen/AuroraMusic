@echo off
REM ============================================================
REM  启动 已打包好的 Aurora Music（免安装版）
REM  对应位置：release\win-unpacked\Aurora Music.exe
REM  如果你想拷给别人用，把整个 win-unpacked 文件夹压缩打包即可
REM ============================================================
chcp 65001 >nul
title Aurora Music - 已打包版启动

cd /d "%~dp0"

set "EXE=release\win-unpacked\Aurora Music.exe"

if not exist "%EXE%" (
    echo [错误] 找不到已打包的 exe：%EXE%
    echo.
    echo 请先在本目录执行：
    echo     npm run build
    echo     npm run dist:dir
    echo.
    pause
    exit /b 1
)

echo [Aurora Music] 启动中：%EXE%
start "" "%EXE%"
