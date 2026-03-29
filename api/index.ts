import express from 'express';
import cors from 'cors';
import { config } from '../src/config';
import trackRouter from '../src/routes/track';
import webhookRouter from '../src/routes/webhook';
import dashboardRouter from '../src/routes/dashboard';

const app = express();

// CORS — allow Lovable pages and local dev
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = config.allowedOrigins.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(origin);
      }
      return origin === pattern;
    });
    callback(null, allowed);
  },
  credentials: true,
}));

// Stripe webhook needs raw body — must be before express.json()
app.use('/api/webhooks', express.raw({ type: 'application/json' }));

// JSON body parser for all other routes
app.use(express.json());

// Routes
app.use('/api/track', trackRouter);
app.use('/api/webhooks', webhookRouter);
app.use('/api/dashboard', dashboardRouter);

// Serve tracking script via API (bypasses CDN cache issues)
const TRACKING_SCRIPT = `"use strict";(function(){var u=document.currentScript?document.currentScript.getAttribute("data-api"):"";if(!u){var scripts=document.querySelectorAll("script[data-api]");for(var idx=0;idx<scripts.length;idx++){var val=scripts[idx].getAttribute("data-api");if(val){u=val;break}}}if(!u){console.warn("[FunnelTracker] No data-api attribute found. Tracking disabled.");return}function m(){return"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(n){var t=Math.random()*16|0;return(n==="x"?t:t&3|8).toString(16)})}function g(n){var t=document.cookie.match(new RegExp("(?:^|; )"+n+"=([^;]*)"));return t?decodeURIComponent(t[1]):null}function p(n,t,e){var o=new Date(Date.now()+e*864e5).toUTCString();document.cookie=n+"="+encodeURIComponent(t)+";expires="+o+";path=/;SameSite=Lax"}var i=g("_fv_id");if(!i){i=m();p("_fv_id",i,365)}var l=["utm_source","utm_medium","utm_campaign","utm_content"];function x(){var n=new URLSearchParams(window.location.search),t={},e=false;for(var j=0;j<l.length;j++){var c=n.get(l[j]);if(c){t[l[j]]=c;e=true}}if(e){sessionStorage.setItem("_fv_utms",JSON.stringify(t))}}function r(){try{return JSON.parse(sessionStorage.getItem("_fv_utms")||"{}")}catch(err){return{}}}x();function a(n,t){var e=u+n,o=JSON.stringify(t);if(navigator.sendBeacon){var c=new Blob([o],{type:"application/json"});if(navigator.sendBeacon(e,c))return}fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:o,keepalive:true}).catch(function(){})}function d(){var n=document.body?document.body.getAttribute("data-funnel-page"):null;if(n)return n;var t=window.location.pathname.toLowerCase();if(t.includes("optin")||t.includes("opt-in")||t==="/")return"optin";if(t.includes("vsl")||t.includes("sales")||t.includes("video"))return"vsl";if(t.includes("checkout")||t.includes("payment"))return"checkout";if(t.includes("thank"))return"thank_you";return t.replace(/^\\/\\//, "")||"unknown"}var s=r();a("/api/track/pageview",{visitor_id:i,page:d(),utm_source:s.utm_source,utm_campaign:s.utm_campaign,utm_medium:s.utm_medium,referrer:document.referrer||undefined});function f(n,t){var e=r();a("/api/track/event",{visitor_id:i,event_name:n,metadata:Object.assign({},e,t)})}function _(n,t){var e=r();a("/api/track/event",{visitor_id:i,event_name:"optin_submit",email:n,metadata:Object.assign({},e,t)})}window.FunnelTracker={track:f,trackOptinSubmit:_,getVisitorId:function(){return i},getUtms:r};console.log("[FunnelTracker] Initialized | visitor="+i+" | page="+d()+" | utms="+JSON.stringify(s))})();`;

app.get('/tracking.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(TRACKING_SCRIPT);
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// For local dev
if (process.env.NODE_ENV !== 'production') {
  const port = parseInt(process.env.PORT || '4891', 10);
  app.listen(port, () => {
    console.log(`[Server] Running on http://localhost:${port}`);
  });
}

export default app;
