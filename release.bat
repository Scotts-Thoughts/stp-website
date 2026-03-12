@echo off
setlocal enabledelayedexpansion

:: Get current version from package.json
for /f "tokens=2 delims=:, " %%a in ('findstr /c:"\"version\"" package.json') do (
    set "CURRENT=%%~a"
    goto :found
)
:found

:: Parse major.minor.patch
for /f "tokens=1,2,3 delims=." %%a in ("%CURRENT%") do (
    set "MAJOR=%%a"
    set "MINOR=%%b"
    set "PATCH=%%c"
)

:: Bump patch
set /a PATCH=%PATCH%+1
set "NEW=%MAJOR%.%MINOR%.%PATCH%"

echo Bumping version: %CURRENT% -^> %NEW%

:: Update package.json version
powershell -Command "(Get-Content package.json) -replace '\"version\": \"%CURRENT%\"', '\"version\": \"%NEW%\"' | Set-Content package.json"

:: Commit and tag
git add package.json
git commit -m "v%NEW%"
git tag "v%NEW%"

:: Build and publish
echo Building and publishing v%NEW%...
npm run electron:release

if %errorlevel% equ 0 (
    echo.
    echo Release v%NEW% published successfully!
    echo Push to remote with: git push origin main --tags
) else (
    echo.
    echo Build failed. The commit and tag have been created locally.
    echo Fix the issue and run: npm run electron:release
)
