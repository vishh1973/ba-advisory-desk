param(
  [string]$AppUrl = $env:BAAD_APP_URL,
  [string]$SupabaseUrl = $env:SUPABASE_URL,
  [string]$SupabaseAnonKey = $env:SUPABASE_ANON_KEY,
  [string]$ClientEmail = $env:BAAD_QA_CLIENT_EMAIL,
  [string]$ClientPassword = $env:BAAD_QA_CLIENT_PASSWORD,
  [string]$AdminEmail = $env:BAAD_QA_ADMIN_EMAIL,
  [string]$AdminPassword = $env:BAAD_QA_ADMIN_PASSWORD
)

$ErrorActionPreference = "Stop"

if (-not $AppUrl) { $AppUrl = "https://baadvisorydesk.com" }
if (-not $SupabaseUrl) { $SupabaseUrl = "https://ydkehgqitnxmvqoicxwu.supabase.co" }
if (-not $SupabaseAnonKey) { $SupabaseAnonKey = "sb_publishable_uPALQNXCxAUarwj9lCSnpg_WtJifDRe" }

$qaFile = Join-Path $env:TEMP "baad-qa-accounts.txt"
if ((-not $ClientEmail -or -not $ClientPassword -or -not $AdminEmail -or -not $AdminPassword) -and (Test-Path $qaFile)) {
  $qa = ((Get-Content $qaFile) -join "`n") | ConvertFrom-StringData
  if (-not $ClientEmail) { $ClientEmail = $qa.client }
  if (-not $ClientPassword) { $ClientPassword = $qa.password }
  if (-not $AdminEmail) { $AdminEmail = $qa.admin }
  if (-not $AdminPassword) { $AdminPassword = $qa.password }
}

function Assert-Value($Condition, $Message) {
  if (-not $Condition) { throw $Message }
}

function Write-Pass($Name, $Detail = "") {
  Write-Output ("PASS | {0} | {1}" -f $Name, $Detail)
}

function Get-QaToken($Email, $Password) {
  Assert-Value $Email "QA email is required."
  Assert-Value $Password "QA password is required."
  $headers = @{ apikey = $SupabaseAnonKey; "Content-Type" = "application/json" }
  $body = @{ email = $Email; password = $Password } | ConvertTo-Json
  Invoke-RestMethod -Uri "$SupabaseUrl/auth/v1/token?grant_type=password" -Method Post -Headers $headers -Body $body -TimeoutSec 20
}

$clientAuth = Get-QaToken $ClientEmail $ClientPassword
$adminAuth = Get-QaToken $AdminEmail $AdminPassword
$clientToken = $clientAuth.access_token
$adminToken = $adminAuth.access_token

Assert-Value $clientToken "Client token was not returned."
Assert-Value $adminToken "Admin token was not returned."
Write-Pass "QA authentication" "client and admin tokens returned"

$adminHeaders = @{ Authorization = "Bearer $adminToken"; "Content-Type" = "application/json" }
$clientHeaders = @{ Authorization = "Bearer $clientToken"; "Content-Type" = "application/json" }
$clientRestHeaders = @{ apikey = $SupabaseAnonKey; Authorization = "Bearer $clientToken"; Accept = "application/json" }
$adminRestHeaders = @{ apikey = $SupabaseAnonKey; Authorization = "Bearer $adminToken"; Accept = "application/json" }

$adminSession = Invoke-RestMethod -Uri "$AppUrl/api/admin-session" -Method Get -Headers $adminHeaders -TimeoutSec 30
Assert-Value $adminSession.isAdmin "Admin session did not verify admin access."
Write-Pass "Admin session" "verified"

$clientUserId = $clientAuth.user.id
$profile = Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/profiles?select=organization_id&id=eq.$clientUserId" -Method Get -Headers $clientRestHeaders -TimeoutSec 20
$organizationId = $profile[0].organization_id
Assert-Value $organizationId "Client profile does not have an organization id."

$projects = Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/client_projects?select=id,name,project_code,status&organization_id=eq.$organizationId&order=created_at.desc" -Method Get -Headers $clientRestHeaders -TimeoutSec 20
$projectId = $projects[0].id
Assert-Value $projectId "Client does not have a project workspace."
Write-Pass "Client project" $projectId

$requestCode = "REL-" + (Get-Date -Format "yyyyMMddHHmmss")
$rpcHeaders = @{ apikey = $SupabaseAnonKey; Authorization = "Bearer $clientToken"; "Content-Type" = "application/json"; Accept = "application/json" }
$requestBody = @{
  p_request_code = $requestCode
  p_organization_id = $organizationId
  p_project_id = $projectId
  p_request_type = "QA release request"
  p_business_goal = "Validate admin release and client deliverable download"
  p_target_audience = "QA team"
  p_attachment_description = "Release path QA request"
  p_credits_estimated = 0
  p_due_at = (Get-Date).AddDays(5).ToString("yyyy-MM-dd")
  p_credit_scope = "rescue"
} | ConvertTo-Json

$request = Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/rpc/create_client_request_intake_v2" -Method Post -Headers $rpcHeaders -Body $requestBody -TimeoutSec 30
$requestId = if ($request -is [array]) { $request[0].request_id } else { $request.request_id }
Assert-Value $requestId "Request RPC returned no request id."
Write-Pass "Client request for release" $requestId

$title = "QA Release Pack " + (Get-Date -Format "yyyyMMddHHmmss")
$prepareBody = @{
  action = "prepare"
  organizationId = $organizationId
  projectId = $projectId
  requestId = $requestId
  title = $title
  deliverableType = "QA deliverable"
  summary = "Admin release live QA summary"
  releaseNote = "Version 1 prepared by automated QA"
} | ConvertTo-Json

$prepared = Invoke-RestMethod -Uri "$AppUrl/api/deliverable-ready-notification" -Method Post -Headers $adminHeaders -Body $prepareBody -TimeoutSec 45
Assert-Value $prepared.deliverableId "Deliverable prepare did not return a deliverable id."
Assert-Value $prepared.versionId "Deliverable prepare did not return a version id."
Assert-Value $prepared.storagePrefix "Deliverable prepare did not return a storage prefix."
Write-Pass "Admin release prepare" ("deliverable={0} version={1}" -f $prepared.deliverableId, $prepared.versionId)

$fileName = "qa-release-pack.pdf"
$fileBytes = [System.Text.Encoding]::UTF8.GetBytes("%PDF-1.4`n% BA Advisory Desk QA release file`n1 0 obj <<>> endobj`ntrailer <<>>`n%%EOF")
$storagePath = "$($prepared.storagePrefix)$fileName"
$storageHeaders = @{ apikey = $SupabaseAnonKey; Authorization = "Bearer $adminToken"; "Content-Type" = "application/pdf"; "x-upsert" = "false" }
Invoke-RestMethod -Uri "$SupabaseUrl/storage/v1/object/private-deliverables/$storagePath" -Method Post -Headers $storageHeaders -Body $fileBytes -TimeoutSec 45 | Out-Null
Write-Pass "Admin deliverable file upload" $fileName

$finalizeBody = @{
  action = "finalize"
  organizationId = $organizationId
  projectId = $projectId
  requestId = $requestId
  deliverableId = $prepared.deliverableId
  versionId = $prepared.versionId
  versionNumber = $prepared.versionNumber
  title = $title
  releaseNote = "Version 1 prepared by automated QA"
  creditsUsed = 0
  notifyClient = $false
  fileRecords = @(
    @{
      storageBucket = "private-deliverables"
      storagePath = $storagePath
      fileName = $fileName
      contentType = "application/pdf"
      fileSizeBytes = $fileBytes.Length
    }
  )
} | ConvertTo-Json -Depth 5

$finalized = Invoke-RestMethod -Uri "$AppUrl/api/deliverable-ready-notification" -Method Post -Headers $adminHeaders -Body $finalizeBody -TimeoutSec 60
Assert-Value $finalized.deliverableId "Deliverable finalize did not return a deliverable id."
Assert-Value ($finalized.uploaded -ge 1) "Deliverable finalize did not record the uploaded file."
Write-Pass "Admin release finalize" ("uploaded={0} credits={1}" -f $finalized.uploaded, $finalized.creditsUsed)

$fileRows = Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/deliverable_version_files?select=id,file_name,project_id,organization_id&deliverable_version_id=eq.$($prepared.versionId)&limit=1" -Method Get -Headers $adminRestHeaders -TimeoutSec 20
$fileId = $fileRows[0].id
Assert-Value $fileId "Released deliverable file row was not found."
Assert-Value ($fileRows[0].project_id -eq $projectId) "Released file is not scoped to the selected project."
Write-Pass "Released file row" $fileId

$adminDownload = Invoke-RestMethod -Uri "$AppUrl/api/deliverable-download-url" -Method Post -Headers $adminHeaders -Body (@{ fileId = $fileId; organizationId = $organizationId; projectId = $projectId } | ConvertTo-Json) -TimeoutSec 30
Assert-Value $adminDownload.signedUrl "Admin deliverable signed URL was not returned."
Write-Pass "Admin deliverable signed download" "ready"

$clientDownload = Invoke-RestMethod -Uri "$AppUrl/api/deliverable-download-url" -Method Post -Headers $clientHeaders -Body (@{ fileId = $fileId; organizationId = $organizationId; projectId = $projectId } | ConvertTo-Json) -TimeoutSec 30
Assert-Value $clientDownload.signedUrl "Client deliverable signed URL was not returned."
Write-Pass "Client deliverable signed download" "ready"

$clientView = Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/client_deliverable_versions?select=deliverable_id,version_id,project_id,title,status,file_id&version_id=eq.$($prepared.versionId)" -Method Get -Headers $clientRestHeaders -TimeoutSec 20
Assert-Value ($clientView.Count -ge 1) "Client deliverable view did not expose the released version."
Assert-Value ($clientView[0].project_id -eq $projectId) "Client deliverable view is not project scoped."
Write-Pass "Client deliverable visibility" $clientView[0].title

Write-Output "All admin release live QA checks passed."
