param([string]$Python = $env:ROAD_HEALTH_PYTHON)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot
if (-not $Python) {
    $Candidates = @(
        (Join-Path $ProjectRoot '.venv/Scripts/python.exe'),
        (Join-Path $env:USERPROFILE 'Downloads/road-health-full/.venv/Scripts/python.exe')
    )
    $Python = $Candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $Python) { throw 'Set ROAD_HEALTH_PYTHON to your backend Python executable, then run this script again.' }
& $Python -m pytest tests/test_surface_inspection.py tests/test_backend.py tests/test_detector_integration.py -k 'not training_artifact' -q --junitxml=.local-road-health/surface-pytest.xml
exit $LASTEXITCODE
