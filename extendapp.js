const store = require('app-store-scraper');
const { parse } = require('papaparse')
const fs = require('node:fs/promises');
const path = require('node:path');

// Environment Variables
const D1_DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID;
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CLOUDFLARE_BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}`;
const RESULT_FOLDER = process.env.RESULT_FOLDER || './result';
const OUTPUT_FOLDER = process.env.OUTPUT_FOLDER || './output';
const COUNTRY = process.env.COUNTRY || 'us';
const KEYWORD = process.env.KEYWORD || 'bible';
const URLS = process.env.URLS || '';
const SAVE_LOCATION = process.env.SAVE_LOCATION || 'local'; // Default to local

async function insertIntoD1(sqlQuery) {
  try {
        const fetchModule = await import('node-fetch')
      const fetch = fetchModule.default

        const url = `${CLOUDFLARE_BASE_URL}/query`;
        const headers = {
            Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json',
        };
        const payload = { sql: sqlQuery };
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        if(!response.ok){
            const error = await response.text();
            console.error(`Failed to insert data: ${response.status} ${response.statusText} ${error}`);
            throw new Error(`Failed to insert data: ${response.status} ${response.statusText} ${error}`)
        }
        const data = await response.json();
        if(data.success){
             console.log('Data inserted successfully.');
        } else {
          console.error(`Failed to insert data: ${data.errors[0].message}`);
          throw new Error(`Failed to insert data: ${data.errors[0].message}`)
        }
    } catch (error) {
        console.error(`Failed to insert data: ${error}`);
        throw error
    }
}
  async function saveCsvToD1(filePath) {
    try {
      const csvFile = await fs.readFile(filePath, { encoding: 'utf8' });
      const { data } = parse(csvFile, { header: true })
      const sqlQuery = `INSERT INTO ios_app_data (platform, type, cid, cname, rank, appid, appname, icon, link, title, updateAt, country, alsoBought) VALUES ${data
        .map(
          (row) =>
            `('${row.platform}', '${row.type}', '${row.cid}', '${row.cname}', ${row.rank}, '${row.appid}', '${row.appname}', '${row.icon}', '${row.link}', '${row.title}', '${row.updateAt}', '${row.country}', '${row.alsoBought ? row.alsoBought.join(',') : null}')`
        )
        .join(', ')};`;

     await insertIntoD1(sqlQuery)
    } catch (error) {
      console.error(`Error reading CSV file '${filePath}': ${error}`);
    }
  }
async function getAppDetails(appId, country){
  try {
    const appDetail = await store.app({
      appId,
        country: country,
        ratings: true,
     });
     return appDetail
  }catch (e){
     console.log(`Error getting app detail ${appId}`, e)
     return null
  }
}
async function getIdsFromKeyword(keyword, country) {
    try {
      const results = await store.search({
          term: keyword,
          country: country,
      });

       return results.map(result => result.appId)

    } catch (error) {
      console.error(`Error searching for keyword '${keyword}': ${error}`);
      return [];
    }
  }
async function getSearchSuggestions(keyword) {
    try {
        const suggestions = await store.suggest({ term: keyword });
        return suggestions.map(suggestion => suggestion.term);
    } catch (error) {
      console.error(`Error getting suggestions for keyword '${keyword}': ${error}`);
      return [];
    }
}
  async function getSimilarApps(appId, country) {
    try {
      const similarApps = await store.similar({
        appId,
          country
        });
      return similarApps.map(app => app.appId);
    } catch (error) {
      console.error(`Error fetching similar apps for app ID '${appId}': ${error}`);
      return [];
    }
  }
async function getReview(appId, country, keyword, appName, outfile) {
    try {
        let allReviews = [];
       let page = 1;
       while (true) {
         const reviews = await store.reviews({
             appId,
              country: country,
              page: page,
           });

            if (!reviews || reviews.length === 0) {
              break;
             }
             allReviews.push(...reviews)
            page++
       }
          const items = allReviews.map(review => {
              return {
                  appid: appId,
                  appname: appName,
                  country: country,
                  keyword: keyword,
                  score: review.score,
                  userName: review.userName?.trim(),
                  date: new Date(review.updated).toISOString(),
                 review: review.text?.replace('\r', ' ').replace('\n', ' ').trim()
             }
          });
          items.forEach(item => outfile.push(item))
        return items
    } catch (error) {
      console.error(`Error fetching reviews for app '${appId}': ${error}`);
      return []
  }
}
async function insertIntoIosReviewData(data) {
   try {
     const fetchModule = await import('node-fetch')
    const fetch = fetchModule.default
         const sqlQuery = `INSERT INTO ios_review_data (appid, appname, country, keyword, score, userName, date, review) VALUES ${data.map(
            (row) =>
              `('${row.appid}', '${row.appname}', '${row.country}', '${row.keyword}', ${row.score}, '${row.userName}', '${row.date}', '${row.review}')`
          ).join(',')};`;
        await insertIntoD1(sqlQuery)
     } catch (error) {
      console.error(`Error insert into review data ${error}`);
    }

}
async function main() {
    try {
        await fs.mkdir(RESULT_FOLDER, { recursive: true });
        const current_time = new Date().toISOString().replace(/[:.]/g, '-');
        let totalAppIds = [];
        if (KEYWORD && COUNTRY) {
            let keywords = KEYWORD.split(',');
            for(const keyword of keywords){
                const suggestions = await getSearchSuggestions(keyword)
                keywords.push(...suggestions)
            }
            keywords = [...new Set(keywords)] // remove dupliated keywords
    
            for (const keyword of keywords) {
                const ids = await getIdsFromKeyword(keyword, COUNTRY);
            totalAppIds.push(...ids);
            }
        }
          totalAppIds = [...new Set(totalAppIds)];

        console.log('found app ids from keyword',totalAppIds.length,totalAppIds);

        if (totalAppIds.length === 0) {
        console.log(`No apps found for keyword '${KEYWORD}'`);
        }
        const cleanAppIds = [];
        if(URLS){
            const urls = URLS.split(',').map(url=> url.trim());
            for(const url of urls){
                if (url.includes('/app/')) {
                    const parts = url.split('/').pop();
                if (parts.startsWith('id')) {
                    cleanAppIds.push(parts.substring(2))
                }
                }
            }
        }
        if(cleanAppIds.length===0){
            console.log(`No apps found for your input '${URLS}'`);
        }

        console.log('found urls in input',cleanAppIds);
        totalAppIds.push(...cleanAppIds);
            totalAppIds = [...new Set(totalAppIds)];
        console.log(`found all app ids from keyword and input: ${totalAppIds}`);
        if (totalAppIds.length === 0) {
        console.log(`No apps found for your input '${KEYWORD} ${URLS}'`);
            return;
        }
        const outfile = [];
        for (const appId of totalAppIds) {
            const appDetail = await getAppDetails(appId, COUNTRY);

            if(appDetail){
                const similarAppIds = await getSimilarApps(appId, COUNTRY)
                outfile.push({
                    platform: 'ios',
                    country: COUNTRY,
                    type: appDetail.free ? 'top-free': 'top-paid',
                    cid: null,
                    cname: null,
                    appname: appDetail.title,
                    rank: null,
                    appid: appDetail.appId,
                    icon: appDetail.icon,
                    link: appDetail.url,
                    title: appDetail.description,
                    updateAt: new Date().toISOString(),
                    alsoBought: similarAppIds
                })
            }
        }
        const outfilePath = path.join(RESULT_FOLDER,`app-details-${current_time}.json`);
          const outfileReviewsPath = path.join(RESULT_FOLDER,`${KEYWORD}-app-reviews-${current_time}.json`);
        const outfileReviews = [];
    
        if (SAVE_LOCATION === 'local' || SAVE_LOCATION === 'both') {
             await fs.writeFile(outfilePath, JSON.stringify(outfile, null, 2));
          }
          for (const appDetail of outfile){
            const reviews=await getReview(appDetail.appid, appDetail.country, KEYWORD, appDetail.appname, outfileReviews )
          }

        if (SAVE_LOCATION === 'local' || SAVE_LOCATION === 'both') {
              await fs.writeFile(outfileReviewsPath, JSON.stringify(outfileReviews, null, 2));
        }

      if (SAVE_LOCATION === 'd1' || SAVE_LOCATION === 'both') {
            const csvPath = path.join(RESULT_FOLDER, `app_data_${current_time}.csv`);
            const csvContent = parse(JSON.stringify(outfile), {header:true,}).data
          await fs.writeFile(csvPath, csvContent);
          await saveCsvToD1(csvPath)
         if (outfileReviews && outfileReviews.length>0) {
                await insertIntoIosReviewData(outfileReviews)
          }
      }

    } catch (error) {
        console.error(`Error in main execution: ${error}`);
    }
}

main();
