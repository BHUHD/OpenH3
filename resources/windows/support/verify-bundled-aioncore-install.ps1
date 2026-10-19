<##
  Compatibility entry point for installers produced before OpenH3 renamed the
  bundled backend resources. The canonical verifier lives at
  verify-bundled-openh3-core-install.ps1.
##>

& (Join-Path $PSScriptRoot 'verify-bundled-openh3-core-install.ps1') @PSBoundParameters
exit $LASTEXITCODE
