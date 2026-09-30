const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}),args:["--no-sandbox"]});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Keep preview independent of external photograph uptime.
 await page.route('https://nia.gov.in/**',r=>r.abort());
 await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8000');await page.waitForSelector('.record-card');
 assert.equal(await page.locator('.record-card').count(),24);
 console.log('Records:',await page.locator('#total').innerText());
 await page.screenshot({path:'/tmp/nia-desktop.png',fullPage:true});
 await page.locator('#next').click();assert.match(await page.locator('#range').innerText(),/^25/);
 await page.locator('#query').fill('Ramchandra');await page.waitForTimeout(160);assert.ok(await page.locator('.record-card').count()>0);
 await page.locator('[data-save]').first().click();
 await page.locator('[data-open]').first().click();assert.equal(await page.locator('#profile').evaluate(e=>e.open),true);
 await page.locator('#reportTab').click();await page.waitForTimeout(100);assert.equal(await page.locator('#reportPanel').isVisible(),true);
 const deepLink=page.url();
 await page.keyboard.press('Escape');assert.equal(await page.locator('#profile').evaluate(e=>e.open),false);
 await page.goto(deepLink);await page.waitForSelector('#profile[open]');
 await page.keyboard.press('Escape');await page.locator('#reset').click();
 await page.locator('#saved').check();assert.equal(await page.locator('.record-card').count(),1);
 await page.locator('#reset').click();await page.locator('#listBtn').click();assert.equal(await page.locator('#records').getAttribute('class'),'cards list');
 const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'nia-public-records.csv');
 await page.locator('#query').fill('zzzzzzzzzzzzzz');await page.waitForTimeout(160);assert.equal(await page.locator('#empty').isVisible(),true);
 await page.locator('#emptyReset').click();await page.locator('#gridBtn').click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/nia-mobile.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.radar-sweep').evaluate(e=>getComputedStyle(e).animationName),'none');
 assert.deepEqual(errors,[]);
 // Error and retained-data handling.
 await page.route('**/data/records.json',r=>r.fulfill({status:503,body:'Unavailable'}));await page.locator('#refresh').click();await page.waitForSelector('#error:not([hidden])');assert.equal(await page.locator('.record-card').count(),12);
 console.log('PASS: pagination, search, save persistence, tabs, deep links, CSV, empty state, mobile width, reduced motion, retained data; no JS errors');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
