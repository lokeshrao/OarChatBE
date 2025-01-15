// Use dynamic import for chai and chai-http
(async () => {
  const chai = await import('chai');
  const chaiHttp = await import('chai-http');
  const app = require('./server');  // Assuming 'server' is CommonJS

  chai.use(chaiHttp);
  const { expect } = chai;

  describe("OarChat API", () => {
    describe("GET /oar", () => {
      it("should confirm the server is running", async () => {
        const res = await chai.request(app).get("/oar");
        expect(res).to.have.status(200);
        expect(res.text).to.include("Server is running");
      });
    });

    describe("GET /users", () => {
      it("should fetch all users", async () => {
        const res = await chai.request(app).get("/oar/users");
        expect(res).to.have.status(200);
        expect(res.body).to.be.an("array");
      });
    });

    describe("POST /users", () => {
      it("should create or update a user", async () => {
        const newUser = {
          user_id: "user123",
          name: "Test User",
          email: "test@example.com",
          username: "testuser",
        };
        const res = await chai.request(app).post("/oar/users").send(newUser);

        expect(res).to.have.status(200);
        expect(res.body).to.have.property("success", true);
        expect(res.body).to.have.property("message").that.is.a("string");
      });

      it("should return a 400 Bad Request for missing required fields", async () => {
        const incompleteUser = {
          name: "Test User",
          email: "test@example.com",
        };
        const res = await chai.request(app).post("/oar/users").send(incompleteUser);

        expect(res).to.have.status(400);
        expect(res.body).to.have.property("error");
      });
    });

    describe("GET /chats", () => {
      it("should fetch all chats for a user", async () => {
        const userId = "user123";
        const res = await chai.request(app).get(`/oar/chats?user_id=${userId}`);

        expect(res).to.have.status(200);
        expect(res.body).to.be.an("array");
      });

      it("should return a 400 Bad Request for missing user_id", async () => {
        const res = await chai.request(app).get("/oar/chats");

        expect(res).to.have.status(400);
        expect(res.body).to.have.property("error");
      });
    });

    describe("POST /chats", () => {
      it("should create a new chat", async () => {
        const newChat = {
          id: "chat123",
          name: "Test Chat",
          type: "group",
          user_ids: ["user123", "user456"],
        };
        const res = await chai.request(app).post("/oar/chats").send(newChat);

        expect(res).to.have.status(200);
        expect(res.body).to.have.property("success", true);
        expect(res.body).to.have.property("message").that.is.a("string");
      });

      it("should return a 400 Bad Request for missing required fields", async () => {
        const incompleteChat = {
          id: "chat123",
          name: "Test Chat",
        };
        const res = await chai.request(app).post("/oar/chats").send(incompleteChat);

        expect(res).to.have.status(400);
        expect(res.body).to.have.property("error");
      });
    });

    describe("POST /messages", () => {
      it("should send a message", async () => {
        const newMessage = {
          id: "msg123",
          content: "Hello, world!",
          chat_id: "chat123",
          sender_id: "user123",
          recipient_type: "group",
        };
        const res = await chai.request(app).post("/oar/messages").send(newMessage);

        expect(res).to.have.status(200);
        expect(res.body).to.have.property("success", true);
        expect(res.body).to.have.property("message").that.is.a("string");
      });

      it("should return a 400 Bad Request for missing required fields", async () => {
        const incompleteMessage = {
          content: "Hello, world!",
          chat_id: "chat123",
        };
        const res = await chai.request(app).post("/oar/messages").send(incompleteMessage);

        expect(res).to.have.status(400);
        expect(res.body).to.have.property("error");
      });
    });
  });
})();
