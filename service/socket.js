const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const ChatRoom = require("../models/chatRoomModel");
const User = require("../models/userModel");
const dotenv = require("dotenv");
dotenv.config({ path: "../config.env" });

module.exports = function (server) {
  const io = new Server(server, {
    path: "/socket.io/",
    cors: {
      origin: "*",
    },
  });

  //驗證token
  io.use((socket, next) => {
    const token = socket.handshake.query?.token;
    if (!token) {
      return next(new Error("請重新登入"));
    }
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) return next(new Error("請重新登入"));
      socket.decoded = decoded;
      next();
    });
  });

  const getUserId = async (token) => {
    const decodedToken = await new Promise((resolve, reject) => {
      jwt.verify(token, process.env.JWT_SECRET, (error, payload) => {
        error ? reject(error) : resolve(payload);
      });
    });
    const currentUser = await User.findById(decodedToken.id);
    return currentUser?._id;
  };

  //建立連接
  io.of("/chat").on("connection", async (socket) => {
    const room = socket.handshake.query?.room;
    const token = socket.handshake.query?.token;
    console.log("connection----", room);
    room && socket.join(room);
    let userId = await getUserId(token);
    userId = userId.toString();
    const clients = io
      .of("/chat")
      .adapter.rooms.get("62863bf54025f20e3d376b34");
    // console.log('io.sockets.adapter.rooms', io.of('/chat').adapter.rooms);
    // console.log('io.sockets.adapter.rooms.has(roomIdentifier)', io.of('/chat').adapter.rooms.has('62863bf54025f20e3d376b34'));
    socket.use(([ event, payload ], next) => {
      console.log("payload", payload);
      if (payload?.message?.length > 100) {
        return next(new Error("您輸入的內容過長"));
      }
      next();
    });
    console.log("clients", clients);
    // 監聽 client發來的訊息
    socket.on("chatMessage", async (msg) => {
      const { message } = msg;
      const createdAt = Date.now();
      await ChatRoom.findByIdAndUpdate(room, {
        $push: { messages: { sender: userId, message, createdAt } },
      });
      //針對該房間廣播訊息
      io.of("/chat")
        .to(room)
        .emit("chatMessage", { message, sender: userId, createdAt });
      console.log("userInfo", room, userId);
      console.log(`傳來的訊息`, msg);
    });
    //歷史訊息
    socket.on("history", async (info) => {
      console.log("history", info, room);
      const { lastTime } = info;
      let msgList = [];
      if (lastTime) {
        console.log("lastTime", lastTime);
        const [queryResult] = await ChatRoom.aggregate([
          { $match: { $expr: { $eq: ["$_id", { $toObjectId: room }] } } },
          {
            $project: {
              messages: 1,
            },
          },
          {
            $project: {
              messages: {
                $slice: [
                  {
                    $filter: {
                      input: "$messages",
                      as: "item",
                      cond: {
                        $lt: ["$$item.createdAt", new Date(lastTime)],
                        // $eq: ["$$item.sender", "62833a81d3692f15d21af56d"],
                      },
                    },
                  },
                  30,
                ],
              },
            },
          },
        ]);
        msgList = queryResult.messages;
      } else {
        msgList = await ChatRoom.find(
          { _id: room },
          { messages: { $slice: -30 } }
        );
        msgList = msgList[0]?.messages;
      }
      socket.emit("history", msgList);
    });
    socket.on("leaveRoom", (room) => {
      console.log("leaveRoom~~~", room);
      socket.leave(room);
    });
    //錯誤處理
    socket.on("error", function (err) {
      // do something with err
      socket.emit("error", err);
    });
    //斷開連接
    socket.on("disconnect", (socket) => {
      console.log("socket-disconnect", socket);
    });
  });

  io.of("/chat").on("connect_error", (err) => {
    console.log(`connect_error due to ${err.message}`);
  });

  return io;
};
