import {createClient} from '@supabase/supabase-js';


const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY); 


async function removeScreenshot(filename){
    const { data, error } = await supabase
    .storage
    .from('screenshots')
    .remove([filename]);
    if(error){
        console.log(`Error: ${error}`);
    }else{
        console.log(`Data: ${data}`);
    }
}

async function main(){
    
    // Get list of all items in storage
    let storage_filenames = [];
    {
        const { data, error } = await supabase
        .storage
        .from('screenshots')
        .list(null, {limit: 1000});

        if(!error){
            data.forEach(file => {
                
                storage_filenames.push(file.name);
            });
        }
    }
    
    // Get list of all logged screenshots
    let screenshot_filenames = [];
    {
        const { data, error } = await supabase
        .from('log')
        .select('screenshot_filename');

        if(!error){
            data.forEach(file => {
                
                screenshot_filenames.push(file.screenshot_filename);
            });
        }
    }

    // Find all files in storage that aren't in the log
    let unlogged_files = [];
    storage_filenames.forEach(filename => {
        if(!screenshot_filenames.includes(filename) && filename != '.emptyFolderPlaceholder'){
            unlogged_files.push(filename);
        }
    });

    // Remove each file to save space
    console.log(`${unlogged_files.length} loose files to remove.`)
    unlogged_files.forEach(async filename => {
        removeScreenshot(filename);
    });


    setTimeout(main, 900000); // 15 minute loop
}
main();