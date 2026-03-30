import { config } from '../config';

interface VideoStats {
  videoId: string;
  title: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
  thumbnail: string;
}

interface ChannelStats {
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
}

const YT_API = 'https://www.googleapis.com/youtube/v3';

async function ytFetch(endpoint: string, params: Record<string, string>) {
  const url = new URL(`${YT_API}/${endpoint}`);
  url.searchParams.set('key', config.youtube.apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`YouTube API error ${res.status}: ${err}`);
  }
  return res.json();
}

export async function getChannelStats(): Promise<ChannelStats> {
  const data = await ytFetch('channels', {
    part: 'statistics',
    id: config.youtube.channelId,
  });

  const stats = data.items?.[0]?.statistics;
  if (!stats) throw new Error('Channel not found');

  return {
    subscriberCount: parseInt(stats.subscriberCount || '0'),
    videoCount: parseInt(stats.videoCount || '0'),
    viewCount: parseInt(stats.viewCount || '0'),
  };
}

export async function getRecentVideos(maxResults = 20): Promise<VideoStats[]> {
  return getAllVideos(maxResults);
}

export async function getAllVideos(limit = 500): Promise<VideoStats[]> {
  const allVideoIds: string[] = [];
  let pageToken = '';

  // Step 1: Paginate through search results to get ALL video IDs
  while (allVideoIds.length < limit) {
    const params: Record<string, string> = {
      part: 'snippet',
      channelId: config.youtube.channelId,
      order: 'date',
      type: 'video',
      maxResults: '50',
    };
    if (pageToken) params.pageToken = pageToken;

    const searchData = await ytFetch('search', params);
    const ids = (searchData.items || [])
      .map((item: any) => item.id?.videoId)
      .filter(Boolean);

    allVideoIds.push(...ids);

    if (!searchData.nextPageToken || ids.length === 0) break;
    pageToken = searchData.nextPageToken;
  }

  if (allVideoIds.length === 0) return [];

  // Step 2: Get detailed stats in batches of 50 (API limit)
  const allVideos: VideoStats[] = [];
  for (let i = 0; i < allVideoIds.length; i += 50) {
    const batch = allVideoIds.slice(i, i + 50).join(',');
    const statsData = await ytFetch('videos', {
      part: 'statistics,snippet',
      id: batch,
    });

    const videos = (statsData.items || []).map((item: any) => ({
      videoId: item.id,
      title: item.snippet?.title || 'Unknown',
      publishedAt: item.snippet?.publishedAt || '',
      views: parseInt(item.statistics?.viewCount || '0'),
      likes: parseInt(item.statistics?.likeCount || '0'),
      comments: parseInt(item.statistics?.commentCount || '0'),
      thumbnail: item.snippet?.thumbnails?.medium?.url || '',
    }));

    allVideos.push(...videos);
  }

  return allVideos;
}
