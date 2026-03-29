// This file contains the tracking script as a string constant.
// It's served via the /tracking.js endpoint.

export const TRACKING_SCRIPT = `"use strict";(function(){
var u=document.currentScript?document.currentScript.getAttribute("data-api"):"";
if(!u){var scripts=document.querySelectorAll("script[data-api]");for(var idx=0;idx<scripts.length;idx++){var val=scripts[idx].getAttribute("data-api");if(val){u=val;break}}}
if(!u){console.warn("[FunnelTracker] No data-api attribute found. Tracking disabled.");return}

function uuid(){return"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(n){var t=Math.random()*16|0;return(n==="x"?t:t&3|8).toString(16)})}
function getCookie(n){var t=document.cookie.match(new RegExp("(?:^|; )"+n+"=([^;]*)"));return t?decodeURIComponent(t[1]):null}
function setCookie(n,t,e){var o=new Date(Date.now()+e*864e5).toUTCString();document.cookie=n+"="+encodeURIComponent(t)+";expires="+o+";path=/;SameSite=Lax"}

var vid=getCookie("_fv_id");
if(!vid){vid=uuid();setCookie("_fv_id",vid,365)}

var utmKeys=["utm_source","utm_medium","utm_campaign","utm_content"];
function captureUtms(){
  var params=new URLSearchParams(window.location.search),utms={},found=false;
  for(var j=0;j<utmKeys.length;j++){var c=params.get(utmKeys[j]);if(c){utms[utmKeys[j]]=c;found=true}}
  if(found){sessionStorage.setItem("_fv_utms",JSON.stringify(utms))}
}
function getUtms(){try{return JSON.parse(sessionStorage.getItem("_fv_utms")||"{}")}catch(e){return{}}}
captureUtms();

function send(path,data){
  var url=u+path,body=JSON.stringify(data);
  fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:body,keepalive:true}).catch(function(){});
}

function detectPage(){
  var attr=document.body?document.body.getAttribute("data-funnel-page"):null;
  if(attr)return attr;
  var p=window.location.pathname.toLowerCase();
  if(p.includes("optin")||p.includes("opt-in")||p==="/")return"optin";
  if(p.includes("vsl")||p.includes("sales")||p.includes("video"))return"vsl";
  if(p.includes("checkout")||p.includes("payment"))return"checkout";
  if(p.includes("thank"))return"thank_you";
  return p.replace(/^\\//, "")||"unknown";
}

var utms=getUtms();
send("/api/track/pageview",{visitor_id:vid,page:detectPage(),utm_source:utms.utm_source,utm_campaign:utms.utm_campaign,utm_medium:utms.utm_medium,referrer:document.referrer||undefined});

var lastOptinEmail="";
function track(name,meta){var u2=getUtms();send("/api/track/event",{visitor_id:vid,event_name:name,metadata:Object.assign({},u2,meta)})}
function trackOptin(email,meta){if(!email||email===lastOptinEmail)return;lastOptinEmail=email;var u2=getUtms();send("/api/track/event",{visitor_id:vid,event_name:"optin_submit",email:email,metadata:Object.assign({},u2,meta)})}

/* Auto-intercept: any form with an email input gets tracked on submit */
function autoIntercept(){
  document.addEventListener("submit",function(e){
    var form=e.target;
    if(!form||form.tagName!=="FORM")return;
    var emailInput=form.querySelector('input[type="email"]');
    if(!emailInput)return;
    var email=emailInput.value;
    if(email){trackOptin(email)}
  },true);
}
if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",autoIntercept)}else{autoIntercept()}

window.FunnelTracker={track:track,trackOptinSubmit:trackOptin,getVisitorId:function(){return vid},getUtms:getUtms};
console.log("[FunnelTracker] Initialized | visitor="+vid+" | page="+detectPage()+" | utms="+JSON.stringify(utms));
})();`;
