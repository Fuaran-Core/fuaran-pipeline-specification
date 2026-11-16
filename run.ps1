#Requires -Version 7.0
<#
.SYNOPSIS
    Verify the Compute pipeline wire specification: its corpus, its schema and its publication boundary.

.DESCRIPTION
    Drop into this directory, run one command, and the specification verifies itself, with no build
    step and no dependency beyond Node.js:

      1. emit.mjs      - a second emitter, written from PIPELINE_WIRE.md alone, re-derives every hash
                         and accept document from its parsed value with every object's members out of
                         order, and mints every digest. A divergence is a defect in the text.
      2. validate.mjs  - index integrity, the JSON Schema, the rules no schema can state, and that
                         every reject vector is refused by the means it declares.
      3. --self-test   - both scripts prove they go RED on a mutated copy held in memory. A
                         conformance check is exactly the kind of code that passes by doing nothing.
      4. the publication-boundary sweep - this repository is public, and names Compute's vocabulary
                         only: every file it would publish is swept for names a reader outside it
                         cannot look up.

    Each stage fails the run by its exit code, never by its transcript.

.PARAMETER SkipSelfTest
    Skip the go-red proofs. Do not skip them in CI.
#>
[CmdletBinding()]
param(
    [switch] $SkipSelfTest
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# Seeded GLOBALLY: `$LASTEXITCODE` is $null until a native command runs, and a script-scope copy would
# hide the code a native command sets whenever this script is invoked with `&`.
$global:LASTEXITCODE = 0

function Invoke-Node {
    # Resolve the node APPLICATION on PATH explicitly - never a shell shim - and pin to the first match,
    # since PATH may hold more than one. Works on every OS PowerShell 7 runs on.
    param([Parameter(ValueFromRemainingArguments = $true)] $Arguments)
    $cmd = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
    & $cmd.Source @Arguments
}

function Invoke-Stage {
    param([string] $Name, [scriptblock] $Body)
    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    & $Body
    if ($LASTEXITCODE -ne 0) {
        Write-Host "==== $Name FAILED (exit $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

$fixtures = Join-Path $PSScriptRoot 'wire-fixtures'

Invoke-Stage 'second emitter: byte comparison and minting' { Invoke-Node (Join-Path $fixtures 'emit.mjs') }
Invoke-Stage 'corpus: index, schema, rules and rejection' { Invoke-Node (Join-Path $fixtures 'validate.mjs') }

if (-not $SkipSelfTest) {
    Invoke-Stage 'self-test: the second emitter goes red' { Invoke-Node (Join-Path $fixtures 'emit.mjs') '--self-test' }
    Invoke-Stage 'self-test: the checker goes red' { Invoke-Node (Join-Path $fixtures 'validate.mjs') '--self-test' }
}

# ── the publication boundary ─────────────────────────────────────────────────
# Each entry: a case-insensitive regex, and what a reader should do about a hit. Word-anchored where a
# term has an ordinary English meaning: a gate that cries wolf gets turned off.
$banned = @(
    @{ Pattern = '\bDiametrical\b(?! Ltd\b)'
       Say     = 'names a private project; only the copyright holder''s registered name is carried' }
    @{ Pattern = '\bToolUp\b'
       Say     = 'names a product family outside this specification' }
    @{ Pattern = '\bFuaran[-.](Build|Roadmap|Dispatch|Judge|Witness|App|Modelling)\b'
       Say     = 'names a component outside this specification''s vocabulary' }
    @{ Pattern = '\broadmapctl\b|\bfuaran-build\b'
       Say     = 'names a private tool' }
    @{ Pattern = '\bRefine Roadmap\b|\bAccept suggestions\b|\bSuggest features\b|\bPrompt next\b|\bMake it so\b|\bSync All\b'
       Say     = 'names an operator command surface this repository is not driven by' }
    @{ Pattern = '\bcookbook\b|\bcampaigns?\b|\bdispatch (take|fold|gate)\b'
       Say     = 'names a private project or its work-scheduling vocabulary' }
    @{ Pattern = '\bdialects?\b|\broutines?\b|\bbranch(es)? of a model\b'
       Say     = 'is modelling vocabulary; this specification names Compute vocabulary only' }
    @{ Pattern = '\bsibling repo\b|\bprivate sibling\b|\bestate\b|\bworkspace\b'
       Say     = 'implies a wider private ecosystem; name the public artefact, or say "an implementation"' }
    @{ Pattern = '\bdata#[0-9]+'
       Say     = 'cites a plan a reader of this repository cannot open' }
)

Invoke-Stage 'publication boundary' {
    # The files this repository would publish: tracked, and untracked but not ignored (so a file is
    # swept before its first commit). This script is the one file not swept, because it spells the
    # patterns; that exception is printed rather than hidden.
    $self = 'run.ps1'
    $files = @(git ls-files --cached --others --exclude-standard) | Where-Object { $_ -and $_ -ne $self }
    if ($files.Count -eq 0) {
        Write-Host 'the sweep found no files to sweep - it would pass having read nothing' -ForegroundColor Red
        $global:LASTEXITCODE = 1
        return
    }
    $hits = foreach ($file in $files) {
        $n = 0
        foreach ($line in [IO.File]::ReadAllLines((Join-Path $PSScriptRoot $file))) {
            $n++
            foreach ($b in $banned) {
                if ($line -match $b.Pattern) {
                    [pscustomobject]@{ File = $file; Line = $n; Hit = $Matches[0]; Say = $b.Say }
                }
            }
        }
    }
    Write-Host ("swept {0} files; not swept: {1} (it spells the patterns)" -f $files.Count, $self)
    Write-Host 'carried: the copyright holder''s registered name in LICENSE and NOTICE (a legal fact, not a reference)'
    if ($hits) {
        foreach ($h in $hits) { Write-Host ("{0}:{1}: '{2}' {3}" -f $h.File, $h.Line, $h.Hit, $h.Say) -ForegroundColor Red }
        $global:LASTEXITCODE = 1
    }
}

Write-Host "`nSpecification verified." -ForegroundColor Green
exit 0
