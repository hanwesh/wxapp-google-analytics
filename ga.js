// 
// https://developers.google.com/analytics/devguides/collection/protocol/v1/parameters
// TODO: 目前只支持screenview,event,timing,exception, 需要支持更多统计类型
//

function GoogleAnalytics(app) {
    this.app = app; //小程序App实例
    this.systemInfo = wx.getSystemInfoSync();
    this.trackers = []; //可以有多个跟踪器，第一个为默认跟踪器
    this.appName = "Mini Program";
    this.appVersion = "unknow";

    //console.log(this.systemInfo);

    var cidKey = '_ga_cid'; // 存用户身份(UUID)

    var cid = wx.getStorageSync(cidKey) || false;
    if (!cid) {
        cid = getUUID();
        wx.setStorageSync(cidKey, cid);
    }
    this.cid = cid;
    this.userAgent = buildUserAgentFromSystemInfo(this.systemInfo);
    var pixelRatio = this.systemInfo.pixelRatio;
    this.sr = [this.systemInfo.windowWidth, this.systemInfo.windowHeight].map(function (x) { return Math.floor(x * pixelRatio) }).join('x');
    this.vp = [this.systemInfo.windowWidth, this.systemInfo.windowHeight].map(function (x) { return Math.floor(x) }).join('x');

    this.sending = false; //数据发送状态
    this.send_queue = []; //发送队列
}
GoogleAnalytics.prototype.setAppName = function (appName) {
    this.appName = appName;
    return this;
}
GoogleAnalytics.prototype.setAppVersion = function (appVersion) {
    this.appVersion = appVersion;
    return this;
}

// 小程序最多只有5个并发网络请求，使用队列方式尽量不过多占用请求
GoogleAnalytics.prototype.send = function (t, hit) {
    var ga = this;

    // 基础字段
    var data = {
        v: 1,
        tid: t.tid,
        cid: ga.cid,
        ds: "app",
        ul: ga.systemInfo.language,
        de: "UTF-8",
        sd: "24-bit",
        je: 0,
        cd: t.screenName,
        an: ga.appName,
        av: ga.appVersion,
        sr: ga.sr,
        vp: ga.vp,
        ua: ga.userAgent
    };

    // 合并参数
    for (var k in hit) {
        data[k] = hit[k];
    }

    console.log(["ga.queue.push", data]);

    this.send_queue.push([data, new Date()]);

    this._do_send();
}
GoogleAnalytics.prototype._do_send = function () {
    if (this.sending) {
        return;
    }

    if (this.send_queue.length <= 0) {
        this.sending = false;
        return;
    }

    this.sending = true;
    var that = this;

    var payloadEncoder = function (data) {
        var s = [];
        for (var k in data) {
            s.push([encodeURIComponent(k), encodeURIComponent(data[k])].join("="));
        }
        return s.join("&");
    };

    var payloads = [];
    while (this.send_queue.length > 0) {
        var sd = this.send_queue[0];
        var data = sd[0];
        data.qt = (new Date()).getTime() - sd[1].getTime(); // 数据发生和发送的时间差，单位毫秒
        data.z = Math.floor(Math.random() * 2147483648);



        var payload = payloadEncoder(data);
        var old_len = payloads.map(function (a) { return a.length; }).reduce(function (a, b) { return a + b; }, 0);
        var add_len = payload.length;

        // 批量上报有限制
        // 1. 单条8K
        // 2. 总共16K
        // 3. 最多20条
        if (old_len + add_len > 16 * 1024 || add_len > 8 * 1024 || payloads.length >= 20) {
            // 但是要保证至少有单次上报的数据
            if (payloads.length > 0) {
                break;
            }
        }

        payloads.push(payload);
        this.send_queue.shift();

        console.log(["ga.queue.presend[" + (payloads.length - 1) + "]", data]);
    }

    var payloadData = payloads.join("\r\n");

    var apiUrl = 'https://www.google-analytics.com/collect';
    if (payloads.length > 1) {
        console.log(["ga.queue.send.batch", payloadData]);
        //使用批量上报接口
        apiUrl = 'https://www.google-analytics.com/batch';
    } else {
        console.log(["ga.queue.send.collect", payloadData]);
    }
    wx.request({
        url: apiUrl,
        data: payloadData,
        method: 'POST',
        header: {
            "content-type": "text/plain" //"application/x-www-form-urlencoded"
        },
        success: function (res) {
            // success
            console.log(["ga:success", res]);
        },
        fail: function (res) {
            // fail
            console.log(["ga:failed", res])
        },
        complete: function () {
            // complete
            that.sending = false;
            setTimeout(function () { that._do_send(); }, 0);
        }
    });
}

GoogleAnalytics.prototype.getDefaultTracker = function () {
    return this.trackers[0];
}
GoogleAnalytics.prototype.newTracker = function (trackerID) {
    var t = new Tracker(this, trackerID);
    this.trackers.push(t);
    return t;
}

function Tracker(ga, tid) {
    this.ga = ga;
    this.tid = tid || "";
    this.screenName = "";
}
Tracker.prototype.setScreenName = function (screenName) {
    this.screenName = screenName;
    return this;
}
// @param Map<String,String> hit
Tracker.prototype.send = function (hit) {
    this.ga.send(this, hit);
    return this;
}

// HitBuilder [基础类]
function HitBuilder() {
    this.hit = {
        t: "screenview", //default
    };
    this.custom_dimensions = [];
    this.custom_metrics = [];
}
// @param int index >= 1
// @param String dimension
HitBuilder.prototype.setCustomDimension = function (index, dimension) {
    this.custom_dimensions.push([index, dimension]);
    return this;
}
// @param int index >= 1
// @param float metric
HitBuilder.prototype.setCustomMetric = function (index, metric) {
    this.custom_metrics.push([index, metric]);
    return this;
}
// @return Map<String,String>
HitBuilder.prototype.build = function () {
    // 处理自定义维度和指标
    var i;
    var cd_arr = this.custom_dimensions;
    var cm_arr = this.custom_metrics;

    for (i = 0; i < cd_arr.length; i++) {
        var cd = cd_arr[i];
        this.hit["cd" + cd[0]] = cd[1];
    }

    for (i = 0; i < cm_arr.length; i++) {
        var cm = cm_arr[i];
        this.hit["cm" + cm[0]] = cm[1];
    }

    return this.hit;
}

// ScreenView
function ScreenViewBuilder() {
    HitBuilder.call(this);
    this.hit.t = "screenview";
}
ScreenViewBuilder.prototype = Object.create(HitBuilder.prototype);
ScreenViewBuilder.prototype.constructor = ScreenViewBuilder;

// Event
function EventBuilder() {
    HitBuilder.call(this);
    this.hit.t = "event";
    this.hit.ec = ""; // category
    this.hit.ea = ""; // action
    this.hit.el = ""; // [label]
    this.hit.ev = 0;  // [value]
    this.hit.ni = 0; // [nonInteraction] default: 0
}
EventBuilder.prototype = Object.create(HitBuilder.prototype);
EventBuilder.prototype.constructor = EventBuilder;

EventBuilder.prototype.setCategory = function (category) {
    this.hit.ec = category;
    return this;
}
EventBuilder.prototype.setAction = function (action) {
    this.hit.ea = action;
    return this;
}
EventBuilder.prototype.setLabel = function (label) {
    this.hit.el = label;
    return this;
}
// @param int
EventBuilder.prototype.setValue = function (value) {
    this.hit.ev = value;
    return this;
}
// @papam bool
EventBuilder.prototype.setNonInteraction = function (nonInteraction) {
    this.hit.ni = nonInteraction ? 1 : 0;
    return this;
}
EventBuilder.prototype.build = function () {
    // 去除无效字段字段
    if (this.hit.ev === 0) delete this.hit.ev;
    if (this.hit.el === "") delete this.hit.el;
    if (this.hit.ni === 0) delete this.hit.ni;

    return HitBuilder.prototype.build.apply(this, arguments);
}
// Social 
// @Deprecated
function SocialBuilder() {
    HitBuilder.call(this);
    this.hit.t = "social";
    this.hit.sn = ""; // network
    this.hit.sa = ""; // action
    this.hit.st = ""; // [target]
}
SocialBuilder.prototype = Object.create(HitBuilder.prototype);
SocialBuilder.prototype.constructor = SocialBuilder;
SocialBuilder.prototype.setNetwork = function (network) {
    this.hit.sn = network;
    return this;
}
SocialBuilder.prototype.setAction = function (action) {
    this.hit.sa = action;
    return this;
}
SocialBuilder.prototype.setTarget = function (target) {
    this.hit.st = target;
    return this;
}
SocialBuilder.prototype.build = function () {
    if (this.hit.st === "") delete this.hit.st;

    return HitBuilder.prototype.build.apply(this, arguments);
}
// Exception
function ExceptionBuilder() {
    HitBuilder.call(this);
    this.hit.t = "exception";
    this.hit.exd = ""; // description
    this.hit.exf = 1; // is_fatal, default:1
}
ExceptionBuilder.prototype = Object.create(HitBuilder.prototype);
ExceptionBuilder.prototype.constructor = ExceptionBuilder;
ExceptionBuilder.prototype.setDescription = function (description) {
    this.hit.exd = description;
    return this;
}
// @param bool is_fatal
ExceptionBuilder.prototype.setFatal = function (is_fatal) {
    this.hit.exf = is_fatal ? 1 : 0;
    return this;
}

// Timing
function TimingBuilder() {
    HitBuilder.call(this);
    this.hit.t = "timing";
    this.hit.utc = ""; // category
    this.hit.utv = ""; // variable
    this.hit.utt = 0;  // value
    this.hit.utl = ""; // [label]
}
TimingBuilder.prototype = Object.create(HitBuilder.prototype);
TimingBuilder.prototype.constructor = TimingBuilder;
TimingBuilder.prototype.setCategory = function (category) {
    this.hit.utc = category;
    return this;
}
TimingBuilder.prototype.setVariable = function (variable) {
    this.hit.utv = variable;
    return this;
}
// @param int 单位：毫秒
TimingBuilder.prototype.setValue = function (value) {
    this.hit.utt = value;
    return this;
}
TimingBuilder.prototype.setLabel = function (label) {
    this.hit.utl = label;
    return this;
}
TimingBuilder.prototype.build = function () {
    if (this.hit.utl === "") delete this.hit.utl;

    return HitBuilder.prototype.build.apply(this, arguments);
}

// TODO: more HitBuilders here...


function getUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0,
            v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function buildUserAgentFromSystemInfo(si) {
    var isAndroid = si.system.toLowerCase().indexOf('android') > -1;
    var isIPad = !isAndroid && si.model.toLowerCase().indexOf('iphone') == -1;
    //console.log([isAndroid, isIPad]);
    if (isAndroid) {
        return "Mozilla/5.0 (Linux; U; " + si.system + "; " + si.model + " Build/000000) AppleWebKit/537.36 (KHTML, like Gecko)Version/4.0 Chrome/49.0.0.0 Mobile Safari/537.36 MicroMessenger/" + si.version;
    } else if (!isIPad) {
        // iOS
        var v = si.system.replace(/^.*?([0-9.]+).*?$/, function (x, y) { return y; }).replace(/\./g, '_');
        return "Mozilla/5.0 (iPhone; CPU iPhone OS " + v + " like Mac OS X) AppleWebKit/602.3.12 (KHTML, like Gecko) Mobile/14C92 MicroMessenger/" + si.version;
    } else {
        // iPad
        var v = si.system.replace(/^.*?([0-9.]+).*?$/, function (x, y) { return y; }).replace(/\./g, '_');
        return "Mozilla/5.0 (iPad; CPU OS " + v + " like Mac OS X) AppleWebKit/534.46 (KHTML, like Gecko) Mobile/10A406 MicroMessenger/" + si.version;
    }
}

function getInstance(app) {
    //必须要App实例
    //if (typeof app.getCurrentPage != 'function') {
    //    var e = "Fatal Error: GoogleAnalytics.getInstance(app): The argument must be instanceof App!";
    //    console.log(e);
    //    throw e;
    //}
    app = app || {};
    if (!app.defaultGoogleAnalyticsInstance) {
        app.defaultGoogleAnalyticsInstance = new GoogleAnalytics(app);
    }
    return app.defaultGoogleAnalyticsInstance;
}

module.exports = {
    GoogleAnalytics: {
        getInstance: getInstance
    },
    HitBuilders: {
        HitBuilder: HitBuilder,
        ScreenViewBuilder: ScreenViewBuilder,
        EventBuilder: EventBuilder,
        //SocialBuilder: SocialBuilder,
        ExceptionBuilder: ExceptionBuilder,
        TimingBuilder: TimingBuilder
    }
}