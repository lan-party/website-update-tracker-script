import {createClient} from '@supabase/supabase-js';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'node:fs';
import crypto from 'crypto';
import nodemailer from 'nodemailer';


const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);  // Supabase client for DB and storage access
puppeteer.use(StealthPlugin());
const browser = await puppeteer.launch({ignoreHTTPSErrors: true});  // Headless browser init
const freeNotifications = 14;  // Number of alert notifications to send without a stripe subscription


async function takeScreenshot(url){
    
    const page = await browser.newPage();

    try{

        console.log(`Taking screenshot of ${url}`);

        // Open page and set window size
        await page.setViewport({width: 960, height: 540});

        // Go to URL
        const [response] = await Promise.all([
            page.waitForNavigation(),
            page.goto(url, {waitUntil: 'load', timeout: 10000})
        ]);

        const statusCode = response.status();
        const pageContent = await page.evaluate(() =>  document.documentElement.outerHTML);
        const pageTitle = await page.title();

        // Format filename and save screenshot
        var filename = "";
        var urlParts = url.split("#")[0].split("?")[0].replaceAll(".","-").replaceAll("%", "").split("/");
        filename = urlParts.splice(2,urlParts.length).join("_");
        var date = new Date().toLocaleString();
        ["/",","," ",":"].forEach( (item) => { date = date.replaceAll(item, "") } );
        filename = filename + "_" + date + ".jpg";
        await (await page.screenshot({path: filename}));
        
        // Read file and upload to supabase storage
        fs.readFile(filename, async (error, fileBuffer) => {
            if (error) {
                console.error("File read error:", error);
            } else {
                const { data, error } = await supabase
                    .storage
                    .from('screenshots')
                    .upload(filename, fileBuffer, {
                        upsert: true,
                        contentType: "image/jpeg"
                    });
                if(error){ console.log(error) }
            }
        });

        // Close page
        await page.close();

        // Delete local copy
        fs.unlink(filename, () => {});

        // Generate checksum from page content
        const pageHash = crypto.createHash('md5').update(pageContent).digest('hex');

        return { filename, statusCode, pageHash, pageTitle };
        
    }catch(error){
        // console.log(`Error on ${url} : `);
        // console.log(error);
        await page.close();
        return false;
    }
    process.exit();
}

async function saveLogEntry(logEntry, webpageId){
    console.log("Saving log entry...");
    console.log({logEntry, webpageId});
    const { error } = await supabase
        .from('log')
        .insert({ 
            status_code: logEntry.statusCode,
            page_checksum: logEntry.pageHash,
            page_title: logEntry.pageTitle,
            screenshot_filename: logEntry.filename,
            webpage_id: webpageId
        });
}

async function sendNotification(webpagePrevious, webpageCurrent, previousNotifications) {
    console.log("Sending notification...");
    console.log({webpagePrevious, webpageCurrent, previousNotifications});

    fs.readFile("email_template.html", 'utf8', async (error, fileBuffer) => {
        if (error) {
            console.error("File read error:", error);
        } else {
        
            fs.readFile("warning_message.html", 'utf8', async (error, fileBuffer2) => {
    
                if (error) {
                    console.error("File read error:", error);
                } else {
            
                var transporter = nodemailer.createTransport({
                    host: process.env.EMAIL_HOST,
                    port: process.env.EMAIL_PORT,
                    auth: {
                        user: process.env.EMAIL_USERNAME,
                        pass: process.env.EMAIL_PASSWORD
                    }
                    });

                    let bodyContent = fileBuffer;
                    let warningMessage = fileBuffer2;
                    let upgradeUrl = process.env.STRIPE_PAYMENT_LINK_1;

                    // Update variable placeholders in email template
                    bodyContent = bodyContent.replaceAll("{{url}}", webpagePrevious.url);
                    bodyContent = bodyContent.replaceAll("{{latest_check_timestamp}}", new Date().toISOString());
                    bodyContent = bodyContent.replaceAll("{{latest_status_code}}", webpageCurrent.statusCode);
                    bodyContent = bodyContent.replaceAll("{{latest_checksum}}", webpageCurrent.pageHash);
                    bodyContent = bodyContent.replaceAll("{{latest_screenshot}}", `${process.env.SUPABASE_URL}/storage/v1/object/public/screenshots/${webpageCurrent.filename}`);
                    bodyContent = bodyContent.replaceAll("{{previous_check_timestamp}}", webpagePrevious.checked_at);
                    bodyContent = bodyContent.replaceAll("{{previous_status_code}}", webpagePrevious.status_code);
                    bodyContent = bodyContent.replaceAll("{{previous_checksum}}", webpagePrevious.page_checksum);
                    bodyContent = bodyContent.replaceAll("{{previous_screenshot}}", `${process.env.SUPABASE_URL}/storage/v1/object/public/screenshots/${webpagePrevious.screenshot_filename}`);
                    bodyContent = bodyContent.replaceAll("{{webpage_id}}", webpagePrevious.id);

                    // Start appending a warning message after half of the free notifications have been sent
                    const remainingNotifications = freeNotifications - previousNotifications;
                    let subject = "";
                    if(previousNotifications >= (freeNotifications / 2) && !webpagePrevious.stripe_subscription_id){

                        bodyContent = bodyContent.replaceAll("{{warning_message}}", warningMessage);
                        bodyContent = bodyContent.replaceAll("{{alerts_remaining}}", remainingNotifications);

                        // Increase the price and change associated payment link as the remaining free alert count decreases
                        let subscriptionPrice = "1";
                        if(remainingNotifications <= 0){
                            subscriptionPrice = "5";
                            upgradeUrl = process.env.STRIPE_PAYMENT_LINK_5;
                        }else if(remainingNotifications > 0 && remainingNotifications <= 2){
                            subscriptionPrice = "4";
                            upgradeUrl = process.env.STRIPE_PAYMENT_LINK_4;
                        }else if(remainingNotifications > 2 && remainingNotifications <= 4){
                            subscriptionPrice = "3";
                            upgradeUrl = process.env.STRIPE_PAYMENT_LINK_3;
                        }else if(remainingNotifications > 4 && remainingNotifications <= 6){
                            subscriptionPrice = "2";
                            upgradeUrl = process.env.STRIPE_PAYMENT_LINK_2;
                        }

                        bodyContent = bodyContent.replaceAll("{{subscription_price}}", subscriptionPrice);
                        subject = `Website Update Alert (${remainingNotifications} remaining) | ${(webpagePrevious.url.split("//")[1].split("?")[0].split("#")[0])} | ${new Date().toISOString().split("T")[0]}`;

                    }else{
                        
                        bodyContent = bodyContent.replaceAll("{{warning_message}}", "");
                        subject = `Website Update Alert | ${(webpagePrevious.url.split("//")[1].split("?")[0].split("#")[0])} | ${new Date().toISOString().split("T")[0]}`
                    }
                    bodyContent = bodyContent.replaceAll("{{upgrade_url}}", `${upgradeUrl}?prefilled_email=${webpagePrevious.notification_email}`);
                    
                    var mailOptions = {
                    from: process.env.EMAIL_USERNAME,
                    to: webpagePrevious.notification_email,
                    subject: subject,
                    html: bodyContent
                    };
                    
                  transporter.sendMail(mailOptions, function(error, info){
                    if (error) {
                      console.log(error);
                    }
                  }); 
                }
            });
        }
    });
}

async function removeOldScreenshots(webpageId) {
    // Select filename of the past 3 entries for a given webpage
    var { data, error } = await supabase
        .from('log')
        .select()
        .eq('webpage_id', webpageId)
        .order('checked_at', { ascending: false })
        .limit(3);

    // // Remove the 3rd oldest file from storage
    if(!error && data.length >= 3){
        console.log(`Removing old screenshot ${data[2].screenshot_filename}`);
        await supabase.storage.from('screenshots').remove([data[2].screenshot_filename]);
    }
}

async function main() {

    // Select all webpages with no log entries
    var { data, error } = await supabase.rpc('get_unchecked_webpages');
    if(!error){
        console.log('=-=-=-= Checking webpages with no log entries =-=-=-=');

        const uncheckedWebpages = data;

        // Loop through each webpage
        uncheckedWebpages.forEach(webpage => {
        
            // Upload a new screenshot to storage
            takeScreenshot(webpage.url).then((data) => {

                if(data){

                    // Save status code, checksum, and screenshot filename in log entry
                    saveLogEntry(data, webpage.id);
                }
            })
        });
    }else{
        console.log(error);
    }

    // Select all outdated webpages
    var { data, error } = await supabase.rpc('get_outdated_webpages');
    if(!error){
        console.log('=-=-=-= Checking outdated webpages =-=-=-=');

        const outdatedWebpages = data;

        // Loop through each webpage
        outdatedWebpages.forEach((webpage, index) => {

            setTimeout(async () => {

                var { count, error } = await supabase
                .from('log')
                .select('*', { count: 'exact', head: true })
                .eq('webpage_id', webpage.id);

            if(!error && (count < freeNotifications+1 || webpage.stripe_subscription_id)){

                takeScreenshot(webpage.url).then((data) => {

                    if(data){
            
                        // If there's a difference in the checksum, status code, or page title compared to the previous entry
                        if (
                            (webpage.track_status_code && webpage.status_code != data.statusCode) ||
                            (webpage.track_page_title && webpage.page_title != data.pageTitle) ||
                            (webpage.track_page_content && webpage.page_checksum != data.pageHash)
                        ){
                            
                            // Save status code, checksum, title, and screenshot filename in log entry
                            saveLogEntry(data, webpage.id);
                        
                            // Send a notification
                            sendNotification(webpage, data, count);
                            
                            // Remove the screenshot before the previous entry if there is one
                            removeOldScreenshots(webpage.id);

                        }
                    }
                });
            }

            }, index * 10000);

        });
    }else{
        console.log(error);
    }

    setTimeout(main, 900000); // 15 minute loop
}
main();