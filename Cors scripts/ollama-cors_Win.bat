@echo off
:: Проверка прав администратора
net session >nul 2>&1
if %errorLevel% == 0 (
    echo Running with admin privileges
) else (
    echo This script requires admin privileges. Please run as administrator.
    pause
    exit /b
)

:: Путь к папке автозагрузки
set "startupFolder=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

:: Имя батника
set "scriptName=%~nx0"

:: Полный путь к текущему скрипту
set "scriptPath=%~f0"

:: Имя ярлыка
set "shortcutName=%scriptName%.lnk"

:: Полный путь к ярлыку
set "shortcutPath=%startupFolder%\%shortcutName%"

:: Проверка, есть ли уже ярлык в автозагрузке
if not exist "%shortcutPath%" (
    echo Creating shortcut in startup folder...

    :: Используем PowerShell для создания ярлыка
    powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%shortcutPath%'); $s.TargetPath = '%scriptPath%'; $s.WorkingDirectory = '%~dp0'; $s.Save();"

    :: Устанавливаем флаг "Запуск от имени администратора" для ярлыка
    powershell -Command "$bytes = [System.IO.File]::ReadAllBytes('%shortcutPath%'); $bytes[0x15] = $bytes[0x15] -bor 0x20; [System.IO.File]::WriteAllBytes('%shortcutPath%', $bytes);"

    echo Shortcut created in startup folder with admin privileges.
)

echo Starting cleanup of existing Ollama processes...

REM Показываем текущие процессы на порту
echo Current processes on port 11434:
netstat -ano | find "11434"

REM Убиваем процесс на порту 11434
FOR /F "tokens=5" %%P IN ('netstat -aon ^| find "11434" ^| find "LISTENING"') DO (
    echo Found Ollama process with PID: %%P
    taskkill /F /PID %%P
    echo Killed process %%P
)

REM Убиваем все процессы ollama
echo Killing all Ollama processes...
taskkill /F /IM "ollama app.exe" /T
taskkill /F /IM ollama.exe /T

REM Ждем достаточно долго
echo Waiting for processes to fully terminate...
timeout /t 5 /nobreak > nul

REM Проверяем, что порт точно освободился
echo Checking if port is now free...
netstat -ano | find "11434"

echo Starting Ollama with CORS...
set OLLAMA_ORIGINS=*
echo OLLAMA_ORIGINS set to: %OLLAMA_ORIGINS%

REM Запускаем Ollama в фоновом режиме
start "" "%USERPROFILE%\AppData\Local\Programs\Ollama\ollama app.exe"

REM Закрываем окно терминала
echo This window will be closed in 5 sec...
timeout /t 5 /nobreak > nul
exit