@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Une fenetre Chrome va s'ouvrir : connecte-toi a TikTok ET a Instagram, puis ferme la fenetre.
node releve.js --login
pause
