
/*
腾讯微证券猜涨跌
[task_local]
35 11 * * 1-5 https://raw.githubusercontent.com/baranwang/quantumult-x-wechat-finance/master/wechat_finance_guess.js, tag=腾讯微证券, img-url=https://raw.githubusercontent.com/baranwang/quantumult-x-wechat-finance/master/wechat_finance.png, enabled=true
[rewrite_local]
https://wzq\.tenpay\.com/resources/vtools/act_task_config_utf8\.json url script-request-header https://raw.githubusercontent.com/baranwang/quantumult-x-wechat-finance/master/wechat_finance_guess.js
[mitm]
hostname = wzq.tenpay.com
*/
/******************** 转换器 ********************/
let isQuantumultX=$task!=undefined;let isSurge=$httpClient!=undefined;let isLoon=isSurge&&typeof $loon!=undefined;var $task=isQuantumultX?$task:{};var $httpClient=isSurge?$httpClient:{};var $prefs=isQuantumultX?$prefs:{};var $persistentStore=isSurge?$persistentStore:{};var $notify=isQuantumultX?$notify:{};var $notification=isSurge?$notification:{};if(isQuantumultX){var errorInfo={error:"",};$httpClient={get:(url,cb)=>{var urlObj;if(typeof url=="string"){urlObj={url:url,}}else{urlObj=url}
$task.fetch(urlObj).then((response)=>{cb(undefined,response,response.body)},(reason)=>{errorInfo.error=reason.error;cb(errorInfo,response,"")})},post:(url,cb)=>{var urlObj;if(typeof url=="string"){urlObj={url:url,}}else{urlObj=url}
url.method="POST";$task.fetch(urlObj).then((response)=>{cb(undefined,response,response.body)},(reason)=>{errorInfo.error=reason.error;cb(errorInfo,response,"")})},}}
if(isSurge){$task={fetch:(url)=>{return new Promise((resolve,reject)=>{if(url.method=="POST"){$httpClient.post(url,(error,response,data)=>{if(response){response.body=data;resolve(response,{error:error,})}else{resolve(null,{error:error,})}})}else{$httpClient.get(url,(error,response,data)=>{if(response){response.body=data;resolve(response,{error:error,})}else{resolve(null,{error:error,})}})}})},}}
if(isQuantumultX){$persistentStore={read:(key)=>{return $prefs.valueForKey(key)},write:(val,key)=>{return $prefs.setValueForKey(val,key)},}}
if(isSurge){$prefs={valueForKey:(key)=>{return $persistentStore.read(key)},setValueForKey:(val,key)=>{return $persistentStore.write(val,key)},}}
if(isQuantumultX){$notify=((notify)=>{return function(title,subTitle,detail,url=undefined){detail=url===undefined?detail:`${detail}\n点击链接跳转: ${url}`;notify(title,subTitle,detail)}})($notify);$notification={post:(title,subTitle,detail,url=undefined)=>{detail=url===undefined?detail:`${detail}\n点击链接跳转: ${url}`;$notify(title,subTitle,detail)},}}
if(isSurge&&!isLoon){$notification.post=((notify)=>{return function(title,subTitle,detail,url=undefined){detail=url===undefined?detail:`${detail}\n点击链接跳转: ${url}`;notify.call($notification,title,subTitle,detail)}})($notification.post);$notify=(title,subTitle,detail,url=undefined)=>{detail=url===undefined?detail:`${detail}\n点击链接跳转: ${url}`;$notification.post(title,subTitle,detail)}}
if(isLoon){$notify=(title,subTitle,detail,url=undefined)=>{$notification.post(title,subTitle,detail,url)}}
/******************** 转换器 ********************/
const cookieKey = 'wechat_finance_cookieKey';

const isGetCookie = typeof $request !== 'undefined';

const notify = (title = '', desc = '') => $notify('腾讯微证券', title, desc);

if (isGetCookie) {
  if ($request.headers['Cookie']) {
    $prefs.setValueForKey($request.headers['Cookie'], cookieKey);
    notify('成功获取 Cookie', '');
  }
  $done({});
} else {
  const headers = {
    Cookie: $prefs.valueForKey(cookieKey),
  };

  $task
    .fetch({
      url:
        'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newkline/newkline?param=sh000001,day,,,1',
    })
    .then((res) => {
      const {
        data: {
          sh000001: {
            qt: { sh000001 },
          },
        },
      } = JSON.parse(res.body);
      const [, , , today, yesterday] = sh000001;
      const now = new Date();
      const date = `${now.getFullYear()}${now.getMonth() < 9 ? '0' : ''}${
        now.getMonth() + 1
      }${now.getDate() < 9 ? '0' : ''}${now.getDate()}`;

      $task
        .fetch({
          url: `https://wzq.tenpay.com/cgi-bin/guess_op.fcgi?action=2&act_id=3&user_answer=${
            today > yesterday ? 1 : 2
          }&date=${date}&channel=0&_=${now.valueOf()}`,
          headers,
        })
        .then((res) => {
          const { retcode, retmsg } = JSON.parse(res.body);
          switch (retcode) {
            case '0':
              $task
                .fetch({
                  url: `https://wzq.tenpay.com/cgi-bin/activity.fcgi?channel=0&activity=guess_new&guess_act_id=3&guess_date=${date}&guess_reward_type=5&_=${now.valueOf()}`,
                  headers,
                })
                .then((res) => {
                  const { retcode, reward_memo, reward_value } = JSON.parse(
                    res.body
                  );
                  if (retcode === '0') {
                    notify(reward_memo, `获得 ${reward_value} 金币`);
                  }
                });
              break;

            default:
              notify('竞猜失败', retmsg);
              break;
          }
        });
    });
}
