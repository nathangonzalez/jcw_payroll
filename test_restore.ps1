$response = Invoke-WebRequest -Uri "https://restore-2026-02-21.labor-timekeeper.jcw-2-android-estimator.uc.r.appspot.com/api/time-entries" -UseBasicParsing
$response.Content | Select-Object -First 500
