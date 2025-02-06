# Website Update Tracker Script
Backend node script for https://website-tracker.com built with Supabase and Puppeteer.

## Getting started
0. Rename .env.template to .env and populate it
1. `npm install`
2. `node --env-file .env index.js`

## Stored Procedures
These stored procedures / database functions are being used to select unchecked and outdated webpages.
### `get_unchecked_webpages`
```
SELECT * FROM
    public.webpages
WHERE
    webpages.id
NOT IN 
    (
        SELECT webpage_id FROM public.log
    )
```

### `get_outdated_webpages`
```
SELECT DISTINCT ON (webpages.id)
  webpages.id, 
  webpages.url, 
  webpages.notification_email, 
  webpages.stripe_subscription_id, 
  log.page_checksum, 
  log.status_code, 
  log.screenshot_filename, 
  log.checked_at
FROM
  webpages
JOIN log ON webpages.id = log.webpage_id
WHERE
webpages.id NOT IN (
  SELECT webpage_id
  FROM
    public.webpages
  JOIN
    public.log ON webpages.id = log.webpage_id
  WHERE
  (
    (
      log.checked_at > NOW() - INTERVAL '24 hours'
      AND
      webpages.stripe_subscription_id IS NULL
    )
    OR
    (
      log.checked_at > NOW() - INTERVAL '5 minutes'
      AND
      webpages.stripe_subscription_id IS NOT NULL
    )
  )
)
```