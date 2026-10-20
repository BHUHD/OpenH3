$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $PSCommandPath
$repoRoot = (Resolve-Path (Join-Path $scriptDir "../..")).ProviderPath
$script = Join-Path $repoRoot "scripts/migration/check-immutability.ps1"
$tmpdir = Join-Path ([System.IO.Path]::GetTempPath()) ("aioncore-migration-test-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmpdir | Out-Null

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Command,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]] $Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

function Invoke-WithEnv {
    param(
        [hashtable] $EnvVars,
        [scriptblock] $Body
    )

    $oldValues = @{}
    foreach ($key in $EnvVars.Keys) {
        $oldValues[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
        [Environment]::SetEnvironmentVariable($key, [string]$EnvVars[$key], "Process")
    }

    try {
        & $Body
    } finally {
        foreach ($key in $EnvVars.Keys) {
            [Environment]::SetEnvironmentVariable($key, $oldValues[$key], "Process")
        }
    }
}

function Invoke-InRepo {
    param(
        [string] $Cwd,
        [int] $ExpectedStatus,
        [string] $ExpectedText,
        [hashtable] $EnvVars
    )

    Push-Location $Cwd
    try {
        $output = ""
        Invoke-WithEnv $EnvVars {
            $previousErrorActionPreference = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            try {
                $result = & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $script 2>&1
                $script:actualStatus = $LASTEXITCODE
                $script:actualOutput = ($result | Out-String)
            } finally {
                $ErrorActionPreference = $previousErrorActionPreference
            }
        }
        $output = $script:actualOutput
        $status = $script:actualStatus
    } finally {
        Pop-Location
    }

    if ($status -ne $ExpectedStatus) {
        [Console]::Error.WriteLine("expected status $ExpectedStatus, got $status")
        [Console]::Error.WriteLine($output)
        exit 1
    }

    if (-not [string]::IsNullOrWhiteSpace($ExpectedText) -and -not $output.Contains($ExpectedText)) {
        [Console]::Error.WriteLine("expected output to contain: $ExpectedText")
        [Console]::Error.WriteLine($output)
        exit 1
    }
}

function New-CaseRepo {
    param([string] $Name)

    $dir = Join-Path $tmpdir $Name
    New-Item -ItemType Directory -Force -Path (Join-Path $dir "crates/openh3-db/migrations") | Out-Null

    Push-Location $dir
    try {
        Invoke-Native git init -q -b main
        Invoke-Native git config user.email test@example.com
        Invoke-Native git config user.name "Migration Test"
        Set-Content -LiteralPath "crates/openh3-db/migrations/001_initial_schema.sql" -Value "-- 001 initial"
        Set-Content -LiteralPath "crates/openh3-db/migrations/002_data_fix.sql" -Value "-- 002 data fix"
        Set-Content -LiteralPath "crates/openh3-db/migrations/manual_fixture.sql" -Value "-- auxiliary sql"
        Invoke-Native git add crates/openh3-db/migrations
        Invoke-Native git commit -q -m "seed migrations"
        Invoke-Native git checkout -q -b feature
    } finally {
        Pop-Location
    }

    return $dir
}

try {
    $modifiedRepo = New-CaseRepo "modified"
    Add-Content -LiteralPath (Join-Path $modifiedRepo "crates/openh3-db/migrations/001_initial_schema.sql") -Value "-- modified"
    Invoke-InRepo $modifiedRepo 1 "Existing migration files from main must not be modified or deleted" @{ AIONCORE_MIGRATION_BASE_REF = "main" }

    $deletedRepo = New-CaseRepo "deleted"
    Remove-Item -LiteralPath (Join-Path $deletedRepo "crates/openh3-db/migrations/002_data_fix.sql")
    Invoke-InRepo $deletedRepo 1 "Existing migration files from main must not be modified or deleted" @{ AIONCORE_MIGRATION_BASE_REF = "main" }

    $auxiliaryRepo = New-CaseRepo "auxiliary"
    Add-Content -LiteralPath (Join-Path $auxiliaryRepo "crates/openh3-db/migrations/manual_fixture.sql") -Value "-- modified auxiliary sql"
    Invoke-InRepo $auxiliaryRepo 1 "Existing migration files from main must not be modified or deleted" @{ AIONCORE_MIGRATION_BASE_REF = "main" }

    $addedRepo = New-CaseRepo "added"
    Set-Content -LiteralPath (Join-Path $addedRepo "crates/openh3-db/migrations/003_new_change.sql") -Value "-- 003 new migration"
    Invoke-InRepo $addedRepo 0 "Migration immutability check passed" @{ AIONCORE_MIGRATION_BASE_REF = "main" }

    $duplicateRepo = New-CaseRepo "duplicate"
    Set-Content -LiteralPath (Join-Path $duplicateRepo "crates/openh3-db/migrations/002_duplicate_change.sql") -Value "-- duplicate 002 migration"
    Invoke-InRepo $duplicateRepo 1 "Duplicate database migration versions are not allowed" @{ AIONCORE_MIGRATION_BASE_REF = "main" }

    $overrideRepo = New-CaseRepo "override"
    Add-Content -LiteralPath (Join-Path $overrideRepo "crates/openh3-db/migrations/001_initial_schema.sql") -Value "-- modified with explicit override"
    Invoke-InRepo $overrideRepo 0 "skipping migration immutability check" @{
        AIONCORE_MIGRATION_BASE_REF = "main"
        AIONCORE_ALLOW_MAIN_MIGRATION_EDIT = "1"
    }

    $renamedRepo = New-CaseRepo "renamed-product-directory"
    Push-Location $renamedRepo
    try {
        Invoke-Native git mv crates/openh3-db crates/aionui-db
        Invoke-Native git commit -qm "legacy directory baseline"
        Invoke-Native git mv crates/aionui-db crates/openh3-db
    } finally {
        Pop-Location
    }
    Invoke-InRepo $renamedRepo 0 "Migration immutability check passed" @{ AIONCORE_MIGRATION_BASE_REF = "main" }
    Add-Content -LiteralPath (Join-Path $renamedRepo "crates/openh3-db/migrations/001_initial_schema.sql") -Value "-- forbidden edit after rename"
    Invoke-InRepo $renamedRepo 1 "Existing migration files from main must not be modified or deleted" @{ AIONCORE_MIGRATION_BASE_REF = "main" }

    $nestedRepo = New-CaseRepo "monorepo"
    Push-Location $nestedRepo
    try {
        New-Item -ItemType Directory -Path "core" | Out-Null
        Invoke-Native git mv crates core/crates
        Invoke-Native git commit -qm "nested Core baseline"
        Invoke-Native git branch -f main HEAD
        Add-Content -LiteralPath "core/crates/openh3-db/migrations/001_initial_schema.sql" -Value "-- forbidden edit"
    } finally {
        Pop-Location
    }
    Invoke-InRepo $nestedRepo 1 "Existing migration files from main must not be modified or deleted" @{ AIONCORE_MIGRATION_BASE_REF = "main" }
    Invoke-InRepo (Join-Path $nestedRepo "core") 1 "Existing migration files from main must not be modified or deleted" @{ AIONCORE_MIGRATION_BASE_REF = "main" }

    Write-Output "Migration immutability script tests passed"
} finally {
    Remove-Item -LiteralPath $tmpdir -Recurse -Force
}
