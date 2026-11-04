@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Installation du releve TrendSaaS sur ce PC ===
where node >nul 2>nul || (echo ERREUR : Node.js n'est pas installe. Installe-le d'abord (voir LISEZMOI.txt) puis relance ce fichier. & pause & exit /b 1)
echo 1/3  Installation de Playwright (une minute)...
call npm install --no-audit --no-fund playwright@1.49.1 >nul 2>&1 || (echo ERREUR npm install & pause & exit /b 1)
echo 2/3  Creation des 3 taches planifiees Windows (00h10, 13h10, 22h10)...
set NODE=
for /f "delims=" %%i in ('where node') do if not defined NODE set "NODE=%%i"
schtasks /Create /F /TN "TrendSaaS releve 00h10" /SC DAILY /ST 00:10 /TR "\"%NODE%\" \"%~dp0releve.js\" --rapide" /RL LIMITED >nul
schtasks /Create /F /TN "TrendSaaS releve 13h10" /SC DAILY /ST 13:10 /TR "\"%NODE%\" \"%~dp0releve.js\"" /RL LIMITED >nul
schtasks /Create /F /TN "TrendSaaS releve 22h10" /SC DAILY /ST 22:10 /TR "\"%NODE%\" \"%~dp0releve.js\"" /RL LIMITED >nul
schtasks /Query /TN "TrendSaaS releve 22h10" >nul 2>nul && (echo      OK : taches creees.) || (echo ERREUR : taches non creees. Clic droit sur installer.bat ^> Executer en tant qu'administrateur.)
echo 3/3  Connexion : une fenetre Chrome va s'ouvrir. Connecte-toi a TikTok ET a Instagram, puis FERME la fenetre.
pause
node releve.js --login
echo.
echo Termine. Pour tester tout de suite : double-clique sur tester.bat
pause
