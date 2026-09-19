$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }
# Script lives in sprites/, repo root is parent
$sprites = $PSScriptRoot
$base = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon"

function Get-Sprite($url, $out) {
    $dir = Split-Path $out -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    curl.exe -fsSL --retry 3 --retry-delay 1 -o $out $url
    if ($LASTEXITCODE -ne 0) { Write-Host "FAIL $url"; return $false }
    return $true
}

$ok = 0
$fail = 0
1..151 | ForEach-Object {
    $n = $_
    $jobs = @(
        @{ u = "$base/$n.png"; o = Join-Path $sprites "standard-96x96\$n.png" }
        @{ u = "$base/shiny/$n.png"; o = Join-Path $sprites "shiny-96x96\$n.png" }
        @{ u = "$base/versions/generation-v/icons/$n.png"; o = Join-Path $sprites "icons-32\$n.png" }
    )
    foreach ($j in $jobs) {
        if (Test-Path $j.o) { $ok++; continue }
        if (Get-Sprite $j.u $j.o) { $ok++ } else { $fail++ }
    }
    if ($n % 25 -eq 0) { Write-Host "progress $n/151 ok=$ok fail=$fail" }
}
Write-Host "done ok=$ok fail=$fail"
