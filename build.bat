@echo off
chcp 65001 > nul
echo ============================================
echo   Build do executavel - App Farmacia
echo ============================================
echo.

echo [1/3] Instalando dependencias...
pip install -r requirements.txt
pip install pyinstaller
if %errorlevel% neq 0 (
    echo ERRO: Falha ao instalar dependencias.
    pause
    exit /b 1
)

echo.
echo [2/3] Criando executavel com PyInstaller...
pyinstaller --onedir --name farmacia ^
  --add-data "public;public" ^
  --add-data "pdf;pdf" ^
  --add-data "src/whatsapp.py;." ^
  --add-data "src/server.py;." ^
  --hidden-import apscheduler.schedulers.background ^
  --hidden-import apscheduler.executors.pool ^
  --hidden-import apscheduler.triggers.cron ^
  --hidden-import apscheduler.triggers.interval ^
  --hidden-import mysql.connector ^
  --hidden-import mysql.connector.pooling ^
  --hidden-import pdfplumber ^
  --hidden-import pdfminer ^
  --hidden-import pdfminer.high_level ^
  --collect-all pdfplumber ^
  --collect-all pdfminer ^
  main.py

if %errorlevel% neq 0 (
    echo ERRO: Falha ao criar executavel.
    pause
    exit /b 1
)

echo.
echo [3/3] Copiando arquivo .env para a pasta de distribuicao...
if exist ".env" (
    copy ".env" "dist\farmacia\.env" > nul
    echo .env copiado com sucesso.
) else (
    echo AVISO: Arquivo .env nao encontrado. Copie manualmente para dist\farmacia\.env
)

echo.
echo ============================================
echo   Executavel criado em: dist\farmacia\
echo ============================================
echo.
echo Para transferir para outra maquina:
echo   1. Copie a pasta inteira: dist\farmacia\
echo   2. Na maquina destino, instale o MySQL e crie o banco "farmacia"
echo   3. Edite o arquivo .env com as credenciais corretas
echo   4. Execute: farmacia.exe
echo.
pause
