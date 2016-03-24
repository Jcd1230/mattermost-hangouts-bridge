var Client = require("hangupsjs");
var Q = require('q');
var http = require("http");
var qs = require("querystring");

var GROUP_ID = "Ugxfu9QF7O2mjXLu_6N4AaABAQ";

var IN_HOOK_ID = "8wfniq93oiyntcxbqf8ipfkwte";

var BOT_ID = "116550526839970800647"; //bot chat_id

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

var send_hangouts_msg = function(user, msg) {
	var bld = new Client.MessageBuilder();
	client.sendchatmessage(GROUP_ID, bld.text((last_sent_author != user ? (user + ": ") : "") + msg).toSegments());
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
		path: "/hooks/" + IN_HOOK_ID,
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
	console.log(JSON.stringify(payload));
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
			user.icon_url = user.photo_url || ("http://placeholdit.imgix.net/~text?txtsize=34&w=60&h=60&txttrack=0&txtclr=ffffff&txt=" + user.first_name.charAt(0) + "&bg=" + getnewcolor());
			user.hangouts_id = chat_id;
			user_info[chat_id] = user;

			console.log("NEW USER");
			console.log(user);
			return user_info[chat_id];
		});
	} else {
		return Q.Promise(function(resolve) {
			resolve(user_info[chat_id]);
		});
	}
}

var hangouts_receive = function(user, segments) {
	console.log("HANGOUTS MESSAGE FROM USER");
	console.log("%j",user);
	var msg = "";
	for (var i = 0; i < segments.length; i++) {
		var seg = segments[i];
		msg = msg + seg.text;
	}
	send_mm_msg(user, msg);
}

client.on('chat_message', function(ev) {
	if (ev.chat_message && ev.chat_message.message_content) {
		var sender = ev.sender_id && ev.sender_id.chat_id || null
		if (sender && sender != BOT_ID) {
			var segments = ev.chat_message.message_content.segment;
			console.log("HANGOUTS MESSAGE");
			console.log(segments)
			//console.log("Chat ID: " + ev.sender_id.chat_id);
			if (Array.isArray(segments)) {
				get_user(client, ev.sender_id.chat_id).then(function(user) {
					hangouts_receive(user, segments);
				});
			}
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

