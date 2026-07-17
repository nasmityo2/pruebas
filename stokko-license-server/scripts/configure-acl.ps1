param(
    [Parameter(Mandatory = $true)]
    [string]$ServerRoot,

    [Parameter(Mandatory = $true)]
    [string]$ServiceIdentity
)

$ErrorActionPreference = 'Stop'
$resolvedRoot = (Resolve-Path -LiteralPath $ServerRoot).Path

& icacls.exe $resolvedRoot /inheritance:r | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudo desactivar la herencia de ACL.' }

& icacls.exe $resolvedRoot /grant:r `
    "${ServiceIdentity}:(OI)(CI)M" `
    '*S-1-5-18:(OI)(CI)F' `
    '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron aplicar las ACL del servidor.' }

& icacls.exe $resolvedRoot /T /C /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron propagar las ACL del servidor.' }

$privateKey = Join-Path $resolvedRoot 'private.key'
if (Test-Path -LiteralPath $privateKey) {
    & icacls.exe $privateKey /inheritance:r | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo aislar la clave privada.' }
    & icacls.exe $privateKey /grant:r `
        "${ServiceIdentity}:R" `
        '*S-1-5-18:F' `
        '*S-1-5-32-544:F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo restringir la clave privada.' }
}

Write-Output '[STOKKO_SERVER_ACL_OK]'
