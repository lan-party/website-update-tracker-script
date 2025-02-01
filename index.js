import {createClient} from '@supabase/supabase-js';
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import crypto from 'crypto';
import nodemailer from 'node:nodemailer';


const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const browser = await puppeteer.launch();


async function takeScreenshot(url){
    // Open page and set window size
    const page = await browser.newPage();
    await page.setViewport({width: 1920, height: 1080});
    
    // Go to URL
    const [response] = await Promise.all([
        page.waitForNavigation(),
        page.goto(url)
    ]);
    const statusCode = response.status();
    const pageContent = await page.evaluate(() =>  document.documentElement.outerHTML);

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

    return { filename, statusCode, pageHash };
}

async function saveLogEntry(logEntry, webpageId){
    const { error } = await supabase
        .from('log')
        .insert({ 
            status_code: logEntry.statusCode,
            page_checksum: logEntry.pageHash,
            screenshot_filename: logEntry.filename,
            webpage_id: webpageId
        });
}

async function removeScreenshot(filename){
    const { data, error } = await supabase
        .storage
        .from('screenshots')
        .remove([filename])
    if(error){
        return false;
    }else{
        return true;
    }

}

async function sendNotification(webpagePrevious, webpageCurrent) {
    console.log("Sending notification...");
    console.log({webpagePrevious, webpageCurrent});
    var transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_POST,
        auth: {
          user: process.env.EMAIL_USERNAME,
          pass: process.env.EMAIL_PASSWORD
        }
      });
      
      var mailOptions = {
        from: process.env.EMAIL_USERNAME,
        to: webpagePrevious.notification_email,
        subject: 'Website Update Alert | ' + (webpagePrevious.url.split("//")[1].split("?")[0].split("#")[0]),
        html: `<html><body><p>A change has been detected on <i>"${webpagePrevious.url}"</i> since it was last checked on ${webpagePrevious.checked_at}.</p>
        <br><p><img src="${process.env.SUPABASE_URL}/storage/v1/object/public/screenshots/${webpageCurrent.filename}" width="300px" /></p>
        <br><p>Create a new webpage alert</p>
        <br><p>or <a href="https://website-tracker.com/unsubscribe/${webpagePrevious.id}">unsubscribe</a></p></body></html>`
      };
      
      transporter.sendMail(mailOptions, function(error, info){
        if (error) {
          console.log(error);
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
        await supabase.storage.from('screenshots').remove([data[2].url]);
    }
}

async function main() {
    setTimeout(async () => {

        // Select all webpages with no log entries
        var { data, error } = await supabase.rpc('get_unchecked_webpages');
        if(!error){

            const uncheckedWebpages = data;

            // Loop through each webpage
            uncheckedWebpages.forEach(webpage => {
            
                // Upload a new screenshot to storage
                takeScreenshot(webpage.url).then((data) => {
                    
                    // Save status code, checksum, and screenshot filename in log entry
                    saveLogEntry(data, webpage.id);
                })
            });
        }else{
            console.log(error);
        }

        // Select all outdated webpages
        var { data, error } = await supabase.rpc('get_outdated_webpages');
        if(!error){

            const outdatedWebpages = data;

            // Loop through each webpage
            outdatedWebpages.forEach(webpage => {
                
                takeScreenshot(webpage.url).then((data) => {
            
                    // If there's a difference in the checksum compared to the previous entry then
                    if(webpage.page_checksum != data.pageHash){
                        
                        // Save status code, checksum, and screenshot filename in log entry
                        saveLogEntry(data, webpage.id);
                    
                        // Send a notification
                        sendNotification(webpage, data);
                        
                        // Remove the screenshot before the previous entry if there is one
                        removeOldScreenshots(webpage.id);

                    }else{

                        // Remove screenshot from storage
                        removeScreenshot(data.filename);
                    }
                });
            });
        }else{
            console.log(error);
        }

        main();
    }, 300000);
}
main();