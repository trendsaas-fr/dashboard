@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Test rapide : lecture de 5 comptes TikTok et 5 comptes Instagram.
node releve.js --test 5
echo.
echo Si tu vois "Fin ... depose dans Supabase", c'est bon. Sinon envoie le fichier releve.log a Claude.
pause
