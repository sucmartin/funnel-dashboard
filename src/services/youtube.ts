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
  // Step 1: Get recent video IDs from the channel
  const searchData = await ytFetch('search', {
    part: 'snippet',
    channelId: config.youtube.channelId,
    order: 'date',
    type: 'video',
    maxResults: String(maxResults),
  });

  const videoIds = searchData.items
    ?.map((item: any) => item.id?.videoId)
    .filter(Boolean)
    .join(',');

  if (!videoIds) return [];

  // Step 2: Get detailed stats for each video
  const statsData = await ytFetch('videos', {
    part: 'statistics,snippet',
    id: videoIds,
  });

  return (statsData.items || []).map((item: any) => ({
    videoId: item.id,
    title: item.snippet?.title || 'Unknown',
    publishedAt: item.snippet?.publishedAt || '',
    views: parseInt(item.statistics?.viewCount || '0'),
    likes: parseInt(item.statistics?.likeCount || '0'),
    comments: parseInt(item.statistics?.commentCount || '0'),
    thumbnail: item.snippet?.thumbnails?.medium?.url || '',
  }));
}
