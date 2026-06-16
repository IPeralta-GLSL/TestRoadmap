@echo off
set "ROOT=%~dp0"

echo Iniciando backend...
start "Backend - TestRoadmap" /D "%ROOT%backend" cmd /c "npm run dev"

timeout /t 2 /nobreak >nul

echo Iniciando frontend...
start "Frontend - TestRoadmap" /D "%ROOT%frontend" cmd /c "npm run dev"

echo.
echo Backend corriendo en http://localhost:3000
echo Frontend corriendo en http://localhost:5173
echo.
echo Se han abierto ventanas secundarias para cada servicio.
echo Para detener los servicios, cierra sus respectivas ventanas.
echo.
pause
