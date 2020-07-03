/**
 * TG频道图片推送
 * @作者：Peng-YM
 *更新地址：https：//raw.githubusercontent.com/Peng-YM/QuanX/master/Tasks/telegram.js
 *使用方法：
 * 1.在频道里面添加频道的id，某些说对于频道https://t.me/ABCD，则填入“ ABCD”
 *例如频道= [“ ABCD”，“ CDEF”]
 * 2.在maxMedias设置每个频道最多显示的图片数量，某些说设置为3，则只会显示最近的3张图片。
 * 3. alwaysNotice控制是否重复显示已经看过的图片，如果设置为false，则只会显示更新的图片。
 */

让频道= [“ xqsranimegif”];
让maxMedias = 3;
让alwaysNotice = false;

const $ = API（“ telegram”）;
如果（$ .read（“ channels”）！==未定义）{
    channel = JSON.parse（$。read（“ channels”））;
}
如果（$ .read（“ maxMedias”）！==未定义）{
    maxMedias = parseInt（$。read（“ maxMedias”））;
}
如果（$ .read（“ alwaysNotice”）！==未定义）{
    alwaysNotice = $ .read（“ alwaysNotice”）;
}

const Updated = JSON.parse（$。read（“ updated”）||“ {}”）;

无极（
    channels.map（异步（channel）=> {
        $ .log（`正在检查频道$ {channel} ...））;
        等待$ .get（`https://rsshub.app/telegram/channel/$ {channel}`）
            .then（（response）=> {
                const body = response.body;
                const channelLink =`https://t.me/s/$ {channel}`;
                const channelName = body.match（/ CDATA \ [（。*）-电报频道\] /）[1];


                $ .log（`Channel Name：$ {channelName}，Link：$ {channelLink}`）;

                //收集媒体
                let medias = [];
                response.body.match（/ <项目> [\ s \ S] *？<\ /项目> / g）.forEach（（项目）=> {
                    const mediaCollection = Array.from（item.matchAll（/（?: img | video）src =“（。*？）” / g），m => m [1]）。filter（m => m！== “未定义”）；
                    const updateTime = new Date（item.match（/ <pubDate>（。*？）<\ / pubDate> /）[1]）。getTime（）;
                    如果（mediaCollection）{
                        if（alwaysNotice || updated [channel] ===未定义|| updated [channel] <updateTime）{
                            medias = medias.concat（mediaCollection）;
                            $ .log（mediaCollection）;
                        } else return;
                    }
                }）;

                $ .log（`所有媒体：$ {medias}`）

                // 推送通知
                for（让i = 0; i <Math.min（medias.length，maxMedias）; i ++）{
                    $ .notify（`[Telegram] $ {channelName}`，“”，“”，{
                        “ media-url”：媒体[i]，
                        “ open-url”：媒体[i]
                    }）;
                    $ .log（`MEDIA：$ {medias [i]}`）;
                }

                //更新时间戳
                Updated [channel] = new Date（）。getTime（）;
                $ .write（JSON.stringify（updated），“ updated”）;
            }）
            .catch（（错误）=> {
                $ .notify（“ [Telegram]”，“”，`❌未找到频道：$ {channel}`）;
                $ .error（错误）;
            }）;
    }）
）
    .catch（（错误）=> $。错误（错误））
    .finally（（）=> $ .done（））;


//更漂亮的忽略
/ **************************************** API ************** ************************ /
s）}）}} get（t）{返回this.isQX吗？（“ string” == typeof t &&（t = {url：t，方法：“ GET”}），$ task.fetch（t））：new Promise（（s，e）=> {this.isLoon || this.isSurge？$ httpClient.get（t，（t，i，o）=> {t？e（t）：s（{status：i.status，headers：i.headers，body：o}）}） ：this.node.request（t，（t，i，o）=> {t？e（t）：s（{... i，status：i.statusCode，body：o}）}）}）}} post（t）{返回this.isQX吗？（“ string” == typeof t &&（t = {url：t}），t.method =“ POST”，$ task.fetch（t））：new Promise（（s，e）=> {this.isLoon || this.isSurge？$ httpClient.post（t，（t，i，o）=> {t？e（t）：s（{状态：i.status，标头：i.headers，正文：o}） }）：this.node.request.post（t，（t，i，o）=> {t？e（t）：s（{... i，status：i.statusCode，body：o}）}} ）}）} initCache（）{如果（this.isQX）返回JSON。parse（$ prefs.valueForKey（this.name）||“ {}”）; 如果（this.isLoon || this.isSurge）返回JSON.parse（$ persistentStore.read（this.name）||“ {}”）; 如果（this.isNode）{const t =`$ {this.name} .json`; 返回this.node.fs.existsSync（t）吗？JSON.parse（this.node.fs.readFileSync（`$ {this.name} .json`））：（this.node.fs.writeFileSync（t，JSON.stringify（{}），{标志：“ wx” }，t => console.log（t）），{}）}} persistCache（）{const t = JSON.stringify（this.cache）; this.log（`FLUSHING DATA：\ n $ {t}`），this.isQX && $ prefs.setValueForKey（t，this.name），（this.isLoon || this.isSurge）&& $ persistentStore.write（t ，this.name），this.isNode && this.node.fs.writeFileSync（`$ {this.name} .json`，t，{flag：“ w”}，t => console.log（t））} write（t，s）{this.log（`SET $ {s} = $ {JSON.stringify（t）}`）），this.cache [s] = t，this。sistenceCache（）} read（t）{返回this.log（`READ $ {t} ==> $ {JSON.stringify（this.cache [t]）}`），this.cache [t]} delete（t ）{this.log（`DELETE $ {t}`），删除this.cache [t]，this.persistCache（）} notify（t，s，e，i）{const o =“ string” == typeof i ？i：void 0，n = e +（null == o？“”：`\ n $ {o}`）；this.isQX &&（void 0！== o？$ notify（t，s，e，{“ open-url”：o}）：$ notify（t，s，e，i）），this.isSurge && $ notification.post（t，s，n），this.isLoon && $ notification.post（t，s，e），this.isNode &&（this.isJSBox？require（“ push”）。schedule（{title，t，正文：s？s +“ \ n” + e：e}）：console.log（`$ {t} \ n $ {s} \ n $ {n} \ n \ n`））} log（t） {this.debug && console.log（t）} info（t）{console.log（t）} error（t）{console.log（“ ERROR：” + t）} wait（t）{返回新的Promise（ s => setTimeout（s，t））} done（t = {}）{this.isQX || this.isLoon || this.isSurge？$ done（t）：this.isNode &&！this.isJSBox &&“未定义”！= type of $ context &&（$ context.headers = t.headers，$ context.statusCode = t.statusCode，$ context.body = t。正文）}}（t，s）}
/ ***************************************************** ******************************** /
