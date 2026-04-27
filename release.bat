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

:: Commit and push, then tag and push tag (GitHub Actions handles the build/publish)
git add package.json
git commit -m "v%NEW%"
git push origin main
if %errorlevel% neq 0 (
    echo.
    echo Push to main failed. Resolve and re-run.
    exit /b 1
)

call npm run build:release

if %errorlevel% equ 0 (
    echo.
    echo Tag v%NEW% pushed. GitHub Actions is building and publishing the release.
    echo Track progress at: https://github.com/Scotts-Thoughts/stp-website/actions
) else (
    echo.
    echo Tag push failed. Inspect the error above.
    exit /b 1
)
