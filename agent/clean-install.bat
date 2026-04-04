@echo off
echo ============================================
echo  MeetAI Agent - Clean Install Script
echo ============================================
echo.
echo Step 1: Removing old node_modules (fixes silero + rtc-node corruption)
if exist node_modules (
  rmdir /s /q node_modules
  echo [OK] node_modules deleted
) else (
  echo [OK] No node_modules to delete
)

echo.
echo Step 2: Removing package-lock.json
if exist package-lock.json (
  del /f package-lock.json
  echo [OK] package-lock.json deleted
)

echo.
echo Step 3: Installing dependencies fresh
npm install
echo.
if %errorlevel% == 0 (
  echo [OK] npm install succeeded!
  echo.
  echo Step 4: Verifying @livekit/rtc-node...
  node -e "import('@livekit/rtc-node').then(() => console.log('[OK] @livekit/rtc-node loaded successfully')).catch(e => console.error('[FAIL] @livekit/rtc-node error:', e.message))"
  echo.
  echo ============================================
  echo  Done! Now run: npm run dev
  echo ============================================
) else (
  echo [FAIL] npm install failed. Check errors above.
)
pause
