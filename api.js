import { google } from 'googleapis';
import readline from 'readline';
import fs from 'fs';
import path from 'path';

// Load credentials
const CREDENTIALS_PATH = path.resolve('credentials.json'); // Path to your credentials file
const TOKEN_PATH = path.resolve('token.json'); // Path to save the access token
const SUB_PATH = path.resolve('subscriptions.json'); // Path to save the subscriptions
const VIDEO_PATH = path.resolve('videos.json'); // Path to save the videos

const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly'];

function getOAuth2Client() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_id, client_secret, redirect_uris } = credentials.installed;
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

function getAccessToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this URL:', authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    rl.question('Enter the code from that page here: ', (code) => {
      rl.close();
      oAuth2Client.getToken(code, (err, token) => {
        if (err) {
          reject(new Error('Error retrieving access token: ' + err));
          return;
        }
        oAuth2Client.setCredentials(token);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
        console.log('Token stored to', TOKEN_PATH);
        resolve(oAuth2Client);
      });
    });
  });
}

async function authorize() {
  const oAuth2Client = getOAuth2Client();

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  } else {
    return getAccessToken(oAuth2Client);
  }
}

async function getSubscriptions(auth) {
  const youtube = google.youtube({ version: 'v3', auth });
  let subscriptions = [];
  let nextPageToken = null;

  do {
    const res = await youtube.subscriptions.list({
      part: 'snippet',
      mine: true,
      maxResults: 50,
      pageToken: nextPageToken, // Use the token to fetch the next page
    });

    // Add the current page of subscriptions to the list
    subscriptions.push(...res.data.items);

    // Get the next page token
    nextPageToken = res.data.nextPageToken;

    console.log(`Fetched ${subscriptions.length} subscriptions so far...`);
  } while (nextPageToken);

  console.log(`Total subscriptions: ${subscriptions.length}`);
  return subscriptions;
}

async function getChannelInfo(auth, channelId) {
  const youtube = google.youtube({ version: 'v3', auth });

  try {
    // Step 1: Get the uploads playlist ID
    const channelRes = await youtube.channels.list({
      part: 'contentDetails,statistics',
      id: channelId, // Pass the channel ID
    });

    if (!channelRes.data.items || channelRes.data.items.length === 0) {
      console.log(`Channel with ID ${channelId} not found.`);
      return null;
    }

    const uploadsPlaylistId = channelRes.data.items[0].contentDetails.relatedPlaylists.uploads;
    const videoCount = channelRes.data.items[0].statistics.videoCount;

    if (!videoCount || videoCount == '0') {
      console.log(`No uploads found for channel with ID ${channelId}.`);
      return { videoCount, lastUploadDate: null };
    }
    
    let playlistRes;
    try{
      // Step 2: Get the latest video from the uploads playlist
      playlistRes = await youtube.playlistItems.list({
        part: 'snippet',
        playlistId: uploadsPlaylistId,
        maxResults: 1, // We only need the most recent video
      });
    } catch (err) {
      console.error(`Upload playlist errored for channel ${channelId}:`, err.message);
      return {videoCount, lastUploadDate: null};
    }

    if (!playlistRes.data.items || playlistRes.data.items.length === 0) {
      console.log(`No uploads found for channel with ID ${channelId}.`);
      return { videoCount, lastUploadDate: null };
    }

    const lastVideo = playlistRes.data.items[0];
    const lastUploadDate = lastVideo.snippet.publishedAt;
    return { videoCount, lastUploadDate };
  } catch (err) {
    console.error(`Error fetching info for channel ${channelId}:`, err.message);
    return null;
  }
}

async function getVideosFromChannel(auth, channelId, PUBLISHED_AFTER) {
  const youtube = google.youtube({ version: 'v3', auth });
  let channelVideos = [];
  let nextPageToken = null;

  do {
    const response = await youtube.search.list({
      part: 'snippet',
      channelId: channelId,
      maxResults: 50, // Fetch up to 50 videos at a time
      order: 'date',
      publishedAfter: PUBLISHED_AFTER.toISOString(),
      type: 'video',
      pageToken: nextPageToken, // Handle pagination
    });

    // Add fetched videos to the list
    channelVideos.push(...response.data.items.map(item => ({ ...item.snippet, ...item.id })));

    // Get the next page token (if any)
    nextPageToken = response.data.nextPageToken;
  } while (nextPageToken);

  return channelVideos;
}

(async () => {
  try {
    // Define the time range
    const PUBLISHED_AFTER = new Date();
    PUBLISHED_AFTER.setDate(PUBLISHED_AFTER.getDate() - 6*7); // 6 weeks ago
    const auth = await authorize();

    let subscriptions = [];
    if (fs.existsSync(SUB_PATH)) {
      subscriptions = JSON.parse(fs.readFileSync(SUB_PATH, 'utf8'));
      console.log(`Subscriptions loaded from ${SUB_PATH}`);
    } else {
      const subsReult = await getSubscriptions(auth);
      for (const sub of subsReult) {
        const channelId = sub.snippet.resourceId.channelId;
        const channelTitle = sub.snippet.title;
        console.log('Getting last upload date for channel:', channelTitle);
        const channelInfo = await getChannelInfo(auth, channelId);
        const subscription = { ...sub.snippet, ...sub.snippet.resourceId, ...channelInfo };
        delete subscription.resourceId;
        subscriptions.push(subscription);
      }
      fs.writeFileSync(SUB_PATH, JSON.stringify(subscriptions, null, 2));
      console.log(`Subscriptions saved to ${SUB_PATH}`);
    }

    const recentlyUploaded = subscriptions.filter(sub => new Date(sub.lastUploadDate) > PUBLISHED_AFTER);
    const latestVideos = [];
    for (const channel of recentlyUploaded) {
      const channelId = channel.channelId;
      try {
        // Fetch videos from this channel
        const channelVideos = await getVideosFromChannel(auth, channelId, PUBLISHED_AFTER);
        console.log(`Fetched ${channelVideos.length} videos for channel ${channel.title}`);
        latestVideos.push(...channelVideos); // Add to the global list
      } catch (err) {
        console.error(`Error fetching videos for channel ${channel.title}:`, err);
      }
    }
    // Sort all videos by publish date (descending)
    latestVideos.sort((a, b) =>
      new Date(b.snippet.publishedAt) - new Date(a.snippet.publishedAt)
    );
    console.log(`Found ${latestVideos.length} videos from ${recentlyUploaded.length} channels`);
    fs.writeFileSync(VIDEO_PATH, JSON.stringify(latestVideos, null, 2));
    console.log(`Videos saved to ${VIDEO_PATH}`);
  } catch (err) {
    console.error('Error:', err);
  }
})();
