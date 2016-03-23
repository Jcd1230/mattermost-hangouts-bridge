var Client = require("hangupsjs");
var Q = require('q');
var http = require("http");
var qs = require("querystring");

var GROUP_ID = "Ugxfu9QF7O2mjXLu_6N4AaABAQ";

var IN_HOOK_ID = "8wfniq93oiyntcxbqf8ipfkwte";
var creds = function() {
	return {
		auth: Client.authStdin
	};
};


var MM_PREFIX = "MM:";
var HO_PREFIX = "HO:";

var client = new Client();
var user_info = {}
var queued_msgs = [];
var connected = false;

var send_hangouts_msg = function(user, msg) {
	var bld = new Client.MessageBuilder();
	client.sendchatmessage(GROUP_ID, bld.text(MM_PREFIX + user + ": " + msg).toSegments());
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
			//try {
				user_info[chat_id] = val.entities[0].properties;
			//} catch (e)
			//	user_info[chat_id] = null;
			//}
			return user_info[chat_id];
		});
	} else {
		return Q.Promise(function(resolve) {
			resolve(user_info[chat_id]);
		});
	}
}

function hangouts_receive(client, user, segments) {
	console.log("%j",user);
	var msg = segments.reduce(function(prev, next) { return prev + next.text; }, "");
	if (msg.indexOf(MM_PREFIX) < 0) {
		var payload = {
			text: HO_PREFIX + msg,
			username: user.first_name || "Unknown"
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
}

client.on('chat_message', function(ev) {
	if (ev.chat_message && ev.chat_message.message_content) {
		var segments = ev.chat_message.message_content.segment;
		console.log(segments)
		if (Array.isArray(segments)) {
			if (ev.sender_id && ev.sender_id.chat_id) {
				get_user(client, ev.sender_id.chat_id).then(function(user) {
					hangouts_receive(client, user, segments);
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
		if (msg.indexOf(HO_PREFIX) < 0) {
			if (connected) {
				send_hangouts_msg(post.user_name, post.text);
			} else {
				console.log("Disconnected, message queued...");
				queued_msgs.push({user: post.user_name, msg: post.text});
			}
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

