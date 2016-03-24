var Client = require("hangupsjs");
var Q = require('q');
var http = require("http");
var qs = require("querystring");
var config = require("./config.js");

var creds = function() {
	return {
		auth: Client.authStdin
	};
};

var colors = [
	"4caf50", //green
	"fb8c00", //orange
	"03a9f4", //blue
	"4527a0", //purple
	"f44336", //red
	"26c6da", //teal
	"ab47bc" //violet
];

var lastcolor = 0;
var getnewcolor = function() {
	var color = colors[lastcolor % colors.length];
	lastcolor++;
	return color;
}

var client = new Client();
var user_info = {}
var queued_msgs = [];
var connected = false;

var last_sent_author = "";

var send_hangouts_msg = function(user, message) {
	var bld = new Client.MessageBuilder();

	if (last_sent_author != user) {
		bld.bold(user).text(": ");
	}

	var msg = (" " + message).replace(/```[\s\S]*```/," %|%_<code snippet>%|%_ ")
		.replace(/```[\s\S]*/," %|%_<code snippet>%|%_ ")
		.replace(/__(.+?)__/,"%|%B$1%|%_")
		.replace(/\*\*(.+?)\*\*/, "%|%B$1%|%_")
		.replace(/_(.+?)_/, "%|%I$1%|%_")
		.replace(/\*(.+?)\*/, "%|%I$1%|%_")
		.replace(/(https?:\/\/\S*)/, "%|%L$1%|%_");

	var sections = msg.split("%|%");

	//console.log("MESSAGE:");
	//console.log(msg);
	//console.log(sections);

	for (var i = 0; i < sections.length; i++) {
		var seg = sections[i];
		if (seg.length < 1) {
			continue;
		}
		var style = seg.charAt(0);
		var cur = seg.substr(1);
		switch (style) {
			case "B":
				bld.bold(cur);
				break;
			case "I":
				bld.italic(cur);
				break;
			case "L":
				bld.link(cur, cur);
				break;
			default:
				bld.text(cur);
		}
	}

	client.sendchatmessage(config.GROUP_ID, bld.toSegments());
	last_sent_author = user;
}

var send_mm_msg = function(user, msg) {
	var payload = {
		text: msg,
		username: user.first_name || "Unknown",
		icon_url: user.icon_url
	};
	var postData = JSON.stringify(payload);
	var req = http.request({
		port: 8065,
		method: "POST",
		path: "/hooks/" + config.IN_HOOK_ID,
		headers: {
			'Content-Type': 'application/json',
			'Content-Length': postData.length
		}
	});
	req.on('error', function(e) {
		console.log(e);
	});
	req.write(postData);
	req.end();
	//console.log(JSON.stringify(payload));
}


var reconnect = function() {
	client.connect(creds).then(function() {
		connected = true;
		console.log("CONNECTED");
		console.log(queued_msgs.length + " MESSAGES WERE QUEUED");
		while (queued_msgs.length > 0 && connected) {
			var msgo = queued_msgs.shift();
			var user = msgo.user || "Unknown";
			var msg = msgo.msg || "";
			send_hangouts_msg(user, msg);
		}
	});
};

var get_user = function(client, chat_id) {
	if (!user_info[chat_id]) {
		return client.getentitybyid([chat_id]).then(function(val) {
			var user = val.entities[0].properties;
			console.log("NEW USER");
			console.log("%j", user);
			var usercolor = getnewcolor();
			console.log("Color " + usercolor);
			var userchar = (user.first_name || (user.emails && user.emails[0]) || "Unknown").charAt(0);
			var autourl = "http://placeholdit.imgix.net/~text?txtsize=80&w=128&h=128&txttrack=0&txtclr=ffffff&txt=" + userchar + "&bg=" + usercolor;
			user.icon_url = user.photo_url || autourl;
			user.hangouts_id = chat_id;
			user_info[chat_id] = user;

			//console.log(user);
			return user_info[chat_id];
		});
	} else {
		return Q.Promise(function(resolve) {
			resolve(user_info[chat_id]);
		});
	}
}

var hangouts_receive = function(user, ev) {
	var segments = ev.chat_message.message_content.segment;
	var imageurl = null;
	try {
		var data = ev.chat_message.message_content.attachment[0].embed_item.data
		for (var id in data) {
			imageurl = data[id][3];
			break;
		}
	} catch(e) {}

	console.log("HANGOUTS MESSAGE FROM USER");
	console.log("%j",user);
	last_sent_author = "";
	var msg = "";

	if (Array.isArray(segments)) {
		for (var i = 0; i < segments.length; i++) {
			var seg = segments[i];
			msg = msg + seg.text;
		}
	}
	if (typeof(imageurl) == "string" ) {
		msg = msg + "\n![]("+imageurl+")"
	}
	if (msg != "") {
		send_mm_msg(user, msg);
	}
}

client.on('chat_message', function(ev) {
	if (ev.chat_message && ev.chat_message.message_content) {
		var sender = ev.sender_id && ev.sender_id.chat_id || null
		if (sender && sender != config.BOT_ID) {
			console.log("HANGOUTS MESSAGE");
			console.log("%j", ev);
			//console.log("Chat ID: " + ev.sender_id.chat_id);
			get_user(client, ev.sender_id.chat_id).then(function(user) {
				hangouts_receive(user, ev);
			});
		}
	}
});

client.on("connect_failed", function(err) {
	connected = false;
	console.log("DISCONNECTED!");
	console.log(err);
	Q.Promise(function(rs) {
		setTimeout(rs, 2000);
	}).then(reconnect);
});

reconnect();

var PORT = 6969;

function handleReq(req, resp) {
	var d = "";
	req.on("data", function(data) {
		d += data;
	});

	req.on("end", function() {
		var post = qs.parse(d);
		var user = post.user_name;
		var msg = post.text;
		console.log("GOT MM MESSAGE:");
		console.log("%j", post);
		if (connected) {
			send_hangouts_msg(post.user_name, post.text);
		} else {
			console.log("Disconnected, message queued...");
			queued_msgs.push({user: post.user_name, msg: post.text});
		}
	});
}

function keepactive() {
	if (connected) {
		client.setactiveclient(true, 20);
		setTimeout(keepactive, 20*1000);
	}
}

keepactive();

var server = http.createServer(handleReq);

server.listen(PORT, function() {});

