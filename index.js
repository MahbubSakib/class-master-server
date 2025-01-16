const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mt3kx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        const userCollection = client.db("classMasterDB").collection("users");
        const teachOnClassMasterCollection = client.db("classMasterDB").collection("teachOnClassMaster");

        // middlewares
        // verify jwt
        const verifyToken = (req, res, next) => {
            console.log('inside verifyToken', req.headers.authorization);
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized access' });
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'unauthorized access' })
                }
                req.decoded = decoded;
                next();
            })
        }

        // use verify admin after verifytoken
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

        // jwt
        // create jwt
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1d' });
            res.send({ token });
        })


        // user
        // find the user role
        app.get('/users/role/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden access' });
            }

            const query = { email: email };
            const user = await userCollection.findOne(query);
            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            const role = user?.role; // 'admin', 'teacher', or 'student'
            res.send({ role });
        });


        // find admin
        app.get('/users/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            if (email !== req.decoded.email) {
                return res.status(403).send({ message: 'forbidden acces' })
            }

            const query = { email: email };
            const user = await userCollection.findOne(query);
            let admin = true;
            if (user) {
                admin = user?.role === 'admin'
            }
            res.send({ admin });
        })

        // create an user
        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await userCollection.findOne(query)
            if (existingUser) {
                return res.send({ message: 'user already exist', insertedId: null })
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        })

        // teach on class master
        app.post('/teachOnClassMaster', async (req, res) => {
            const teachOnRequest = req.body;
            const result = await teachOnClassMasterCollection.insertOne(teachOnRequest);
            res.send(result);
        })

        // get user role for teach on class master page to see if the user is teacher or not
        app.get('/userRole', async (req, res) => {
            const { email } = req.query;
            try {
                const user = await userCollection.findOne({ email });
                if (user) {
                    res.send({ role: user.role });
                } else {
                    res.status(404).send({ message: 'User not found' });
                }
            } catch (error) {
                res.status(500).send({ message: 'Error', error })
            }
        });

        // get teacher's pending request
        app.get('/teachersRequest', async (req, res) => {
            const requests = await teachOnClassMasterCollection.find().toArray();
            res.send(requests);
        })

        // update the status of a teacher request
        app.post('/updateTeacherRequest/:id', async (req, res) => {
            const requestId = req.params.id;
            const { status } = req.body;
            try {
                const requestUpdate = await teachOnClassMasterCollection.updateOne(
                    { _id: ObjectId(requestId) },
                    { $set: { status } }
                );

                if (status === 'accepted') {
                    // Update the user role to 'teacher'
                    const request = await teachOnClassMasterCollection.findOne({ _id: ObjectId(requestId) });
                    const userEmail = request.email;

                    await usersCollection.updateOne(
                        { email: userEmail },
                        { $set: { role: 'teacher' } }
                    );
                }
                res.send({ message: 'Request updated successfully', requestUpdate });
            } catch (error) {
                res.status(500).send({ message: 'Error updating teacher request' });
            }
        });

        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('server is running');
})

app.listen(port, () => {
    console.log(`running form port: ${port}`);
})