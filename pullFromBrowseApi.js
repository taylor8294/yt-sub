import fs from 'fs';

async function doFetch(browseIdOrContinuationToken){
  /* Go to youtube, scroll to bottom, copy /youtubei/v1/browse call as fetch (Node.js) */
  const headers = { /* paste headers from fetch call here */ };
  const body = { /* paste body from fetch call here */ };
  delete body['browseId'];
  delete body['continuation'];
  body[browseIdOrContinuationToken.startsWith('FE') ? "browseId" : "continuation"] = browseIdOrContinuationToken;
  const response = await fetch("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", {
    headers,
    "body": JSON.stringify(body),
    "method": "POST",
    // "mode": "cors",
    // "credentials": "include"
  });
  const responseData = await response.json();
  return responseData;
}

function handleFirstPage(responseData){
  if(responseData.contents && responseData?.contents?.twoColumnBrowseResultsRenderer?.tabs[0]?.tabRenderer?.content){ 
    const richGridRenderer = responseData.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer;
    if(richGridRenderer){
      const videos = richGridRenderer.contents.filter(item => !!item.richItemRenderer).map(item => {
        const videoRenderer = item.richItemRenderer.content.videoRenderer;
        const videoId = videoRenderer.videoId;
        const title = videoRenderer.title?.runs[0].text;
        const description = videoRenderer.descriptionSnippet?.runs[0].text;
        const lengthText = videoRenderer.lengthText?.simpleText;
        const len = ['0','0','0',...(lengthText ? lengthText.split(':') : [])].slice(-3).map(i=>(i.length<2?'0':'')+i).join(':'); 
        const length = videoRenderer.lengthText ? len : null;
        const channel = videoRenderer.ownerText.runs[0].text;
        const url = `https://www.youtube.com${videoRenderer.navigationEndpoint.commandMetadata.webCommandMetadata.url}`;
        const channelUrl = `https://www.youtube.com${videoRenderer.ownerText.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url}`;
        const published = videoRenderer.publishedTimeText?.simpleText;
        const views = videoRenderer.viewCountText?.simpleText;
        const thumbnail = videoRenderer.thumbnail.thumbnails[0].url.split('?')[0];
        const isUpcoming = videoRenderer.upcomingEventData ? new Date(videoRenderer.upcomingEventData.startTime*1000).toISOString() : false;
        return {videoId, title, description, length, channel, url, channelUrl, published, views, thumbnail, isUpcoming};
      });
      const continuation = richGridRenderer.contents.findLast(item => !!item.continuationItemRenderer).continuationItemRenderer.continuationEndpoint.continuationCommand.token;
      return { videos, continuation };
    } else if(responseData.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer){
      const sectionListRenderer = responseData.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer;
      try {
        const msg = sectionListRenderer.contents[0].itemSectionRenderer.contents[0].backgroundPromoRenderer.bodyText.runs[0].text;
        console.log(msg);
      } catch(e){
        console.log('Unexpected response format', sectionListRenderer);
      }
    } else {
      console.log('Unexpected response format', responseData.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content);
    }
  } else {
    console.log('Unexpected response format', responseData);
  }
}

function handleContinuation(responseData){ 
  if(responseData.onResponseReceivedActions){
    const videos = responseData.onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems.filter(item => !!item.richItemRenderer).map(item => {
      const videoRenderer = item.richItemRenderer.content.videoRenderer;
      const videoId = videoRenderer.videoId;
      const title = videoRenderer.title.runs[0].text;
      const description = videoRenderer.descriptionSnippet ? videoRenderer.descriptionSnippet.runs[0].text : '';
      const lengthText = videoRenderer.lengthText?.simpleText;
      const len = ['0','0','0',...(lengthText ? lengthText.split(':') : [])].slice(-3).map(i=>(i.length<2?'0':'')+i).join(':'); 
      const length = videoRenderer.lengthText ? len : null;
      const channel = videoRenderer.ownerText.runs[0].text;
      const url = `https://www.youtube.com${videoRenderer.navigationEndpoint.commandMetadata.webCommandMetadata.url}`;
      const channelUrl = `https://www.youtube.com${videoRenderer.ownerText.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url}`;
      const published = videoRenderer.publishedTimeText?.simpleText;
      const views = videoRenderer.viewCountText?.simpleText;
      const thumbnail = videoRenderer.thumbnail.thumbnails[0].url;
      const isUpcoming = videoRenderer.upcomingEventData ? new Date(videoRenderer.upcomingEventData.startTime*1000).toISOString() : false;
      return {videoId, title, description, length, channel, url, channelUrl, published, views, thumbnail, isUpcoming};
    });
    const continuation = responseData.onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems.findLast(item => !!item.continuationItemRenderer).continuationItemRenderer.continuationEndpoint.continuationCommand.token;
    return { videos, continuation };
  } else {
    console.log('Unexpected response format', responseData);
  }
}

function getNextAvailableFileName(fn){
  const files = fs.readdirSync('.');
  let fileName = fn;
  let i = 2;
  while(files.includes(fileName)){
    fileName = fn.split('.').slice(0,-1).join('.') + ` (${i++})` + (fn.split('.').length > 1 ? '.'+fn.split('.').slice(-1)[0] : '');
  }
  return fileName;
}

function getWaitTime(n){
  // WaitTime(n)=400⋅ln(0.5⋅n+1)+1
  return Math.round(400*Math.log(0.5*(n+1)+1)+1);
}

(async () => {
  const videos = [];
  let result = handleFirstPage(await doFetch('FEsubscriptions'));
  if(result && result.videos){
    videos.push(...result.videos);
    console.log(`${videos.length} videos...`);
    let i = 0;
    while(result.continuation && videos.length < 500 && i < 10){ 
      // increase wait time with each call to avoid hitting any rate limiting
      const waitTime = getWaitTime(i++);
      console.log(`Waiting ${waitTime}ms...`);
      await new Promise(r => setTimeout(r, waitTime));
      result = handleContinuation(await doFetch(result.continuation));
      videos.push(...result.videos);
      console.log(`${videos.length} videos...`);
    }
  }
  const fileName = getNextAvailableFileName('videos.json');
  fs.writeFileSync(fileName, JSON.stringify(videos, null, 2));
  console.log(`Wrote ${videos.length} videos to ${fileName}`);
})();
