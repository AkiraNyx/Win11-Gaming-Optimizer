@echo off
setlocal EnableExtensions
title Win11 Optimizer - Quick Start

call "%~dp0Start.bat"
set "exitCode=%errorlevel%"
endlocal & exit /b %exitCode%
