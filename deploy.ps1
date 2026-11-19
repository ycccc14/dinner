# Publishes the app to GitHub Pages (https://ycccc14.github.io/dinner/).
# Runs every test first and publishes nothing if one fails.
#   .\deploy.ps1 "What changed"
# Remember to bump VERSION in sw.js and js/app.js: phones check for a new sw.js every time the app opens.
# First time only: creates the public repo ycccc14/dinner and turns on GitHub Pages.
param([string]$Description = 'Update')
$ErrorActionPreference = 'Stop'
$env:Path = "C:\Program Files\nodejs;C:\Program Files\GitHub CLI;C:\Program Files\Git\cmd;$env:Path"
Set-Location $PSScriptRoot

node test/logic.test.js
if ($LASTEXITCODE -ne 0) { throw 'Logic tests failed - nothing was published.' }
node test/ui-test.js
if ($LASTEXITCODE -ne 0) { throw 'UI test failed - nothing was published.' }
node test/layout-test.js
if ($LASTEXITCODE -ne 0) { throw 'Layout test failed - nothing was published.' }
node test/sync-server.test.js
if ($LASTEXITCODE -ne 0) { throw 'Sync server tests failed - nothing was published.' }
node test/sync-test.js
if ($LASTEXITCODE -ne 0) { throw 'Two-phone sync test failed - nothing was published.' }

$ErrorActionPreference = 'Continue' # git and clasp write harmless warnings to stderr; check exit codes instead
# Sync server (server/, Google Apps Script "jinwan sync"): update the code and the existing web-app deployment (same URL).
$env:Path = "$env:APPDATA\npm;$env:Path"
clasp push --force
if ($LASTEXITCODE -ne 0) { throw 'Pushing the sync server code failed.' }
clasp update-deployment AKfycbxPsKQwN_PYYhSI4smXEy9uk1tEl0i0kXmUiHOhpT9yNX7KLPWH_UYGiDgBvXJPHBhUfg --description $Description
if ($LASTEXITCODE -ne 0) { throw 'Updating the sync server deployment failed.' }

$first = -not (Test-Path (Join-Path $PSScriptRoot '.git'))
if ($first) {
  git init -q -b main
  if ($LASTEXITCODE -ne 0) { throw 'git init failed.' }
}
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -q -m $Description -m 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
}
if ($first) {
  gh repo create ycccc14/dinner --public --source . --remote origin --push --description 'Dinner picker PWA'
  if ($LASTEXITCODE -ne 0) { throw 'Creating the GitHub repo failed.' }
  gh api -X POST repos/ycccc14/dinner/pages -f 'source[branch]=main' -f 'source[path]=/' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Turning on GitHub Pages failed.' }
} else {
  git push -q -u origin main
  if ($LASTEXITCODE -ne 0) { throw 'Publishing to GitHub failed.' }
}
Write-Host "Done: $Description  ->  https://ycccc14.github.io/dinner/  (the first publish takes about a minute to go live)"
