const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIP_SECRET_KEY)

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
        const classCollection = client.db("classMasterDB").collection("class");
        const assignmentCollection = client.db("classMasterDB").collection("assignment");
        const submissionCollection = client.db("classMasterDB").collection("submission");
        const paymentCollection = client.db("classMasterDB").collection("payment");
        const enrollmentCollection = client.db("classMasterDB").collection("enrollment");

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
        // get all usersfor admin dashboard
        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
            try {
                const { name, email } = req.query; // Capture query parameters
                const filter = {};

                // Apply filters if provided
                if (name) {
                    filter.name = { $regex: name, $options: 'i' }; // Case-insensitive regex for name
                }
                if (email) {
                    filter.email = { $regex: email, $options: 'i' }; // Case-insensitive regex for email
                }

                const result = await userCollection.find(filter).toArray();
                res.send(result);
            } catch (error) {
                console.error('Error fetching users:', error);
                res.status(500).send({ message: 'Error fetching users' });
            }
        });

        // get specific users profile
        app.get('/user-profile', verifyToken, async (req, res) => {
            try {
                const userEmail = req.query.email || req.user?.email; // Fetch from query if not available in token
                if (!userEmail) {
                    return res.status(400).send({ message: 'Email is required to fetch user profile.' });
                }

                const user = await userCollection.findOne(
                    { email: userEmail },
                    { projection: { name: 1, role: 1, email: 1, phone: 1, photo: 1 } } // Only fetch required fields
                );

                if (!user) {
                    return res.status(404).send({ message: 'User not found.' });
                }

                res.send(user);
            } catch (error) {
                console.error('Error fetching user profile:', error);
                res.status(500).send({ message: 'Error fetching user profile.' });
            }
        });



        // make an user admin
        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await userCollection.updateOne(filter, updatedDoc);
            res.send(result);
        })

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
            const { email } = req.body;

            try {
                // Check if a request already exists for the user
                const existingRequest = await teachOnClassMasterCollection.findOne({ email });

                if (existingRequest) {
                    // Update the existing request status to pending
                    const updateResult = await teachOnClassMasterCollection.updateOne(
                        { email },
                        { $set: { ...req.body, status: 'pending' } }
                    );
                    return res.send({ message: 'Request updated successfully', updateResult });
                }

                // If no request exists, insert a new one
                const insertResult = await teachOnClassMasterCollection.insertOne(req.body);
                res.send({ message: 'Request created successfully', insertResult });
            } catch (error) {
                console.error('Error creating/updating request:', error);
                res.status(500).send({ message: 'Error creating/updating request' });
            }
        });


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
            const { email } = req.query;
            try {
                const requests = await teachOnClassMasterCollection.find(email ? { email } : {}).toArray();
                res.send(requests);
            } catch (error) {
                res.status(500).send({ message: 'Error fetching requests', error });
            }
        });

        // update the role of a teacher
        app.post('/updateTeacherRequest/:id', async (req, res) => {
            const requestId = req.params.id;
            const { status } = req.body;

            try {
                const requestUpdate = await teachOnClassMasterCollection.updateOne(
                    { _id: new ObjectId(requestId) },
                    { $set: { status } }
                );

                if (status === 'accepted') {
                    const request = await teachOnClassMasterCollection.findOne({ _id: new ObjectId(requestId) });
                    const userEmail = request.email.trim();

                    // Update user role in userCollection
                    await userCollection.updateOne(
                        { email: { $regex: `^${userEmail}$`, $options: 'i' } },
                        { $set: { role: 'teacher' } }
                    );
                }

                res.send({ message: 'Request updated successfully', requestUpdate });
            } catch (error) {
                console.error('Error updating request:', error);
                res.status(500).send({ message: 'Error updating request' });
            }
        });



        // class -------------------------
        // get all classes in admin dashboard
        app.get('/allClass', async (req, res) => {
            const result = await classCollection.find().toArray();
            res.send(result);
        })

        app.get('/allApprovedClasses', async (req, res) => {
            const result = await classCollection.find({ status: 'approved' }).toArray();
            res.send(result);
        })

        // get my classes
        app.get('/myClass', async (req, res) => {
            const email = req.query.email; // Get the email from the query parameters
            try {
                const result = await classCollection.find({ email: email }).toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Error fetching classes', error });
            }
        });

        // get class details by id
        app.get('/class/:id', async (req, res) => {
            const id = req.params.id;
            try {
                const result = await classCollection.findOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Error fetching class details', error });
            }
        });

        // create an assignment
        app.post('/assignment', async (req, res) => {
            const assignment = req.body;
            try {
                const result = await assignmentCollection.insertOne(assignment);
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Error adding assignment', error });
            }
        });

        // fetch assignment for a class
        app.get('/assignments/:classId', async (req, res) => {
            const classId = req.params.classId;
            try {
                const result = await assignmentCollection.find({ classId }).toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Error fetching assignments', error });
            }
        });

        // fetch total submission
        app.get('/submissions/:classId', async (req, res) => {
            const classId = req.params.classId;
            try {
                const result = await submissionCollection.countDocuments({ classId });
                res.send({ totalSubmissions: result });
            } catch (error) {
                res.status(500).send({ message: 'Error fetching submissions', error });
            }
        });

        // Update class status -- admin page
        app.patch('/updateClassStatus/:id', async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;

            try {
                const filter = { _id: new ObjectId(id) };
                const updateDoc = {
                    $set: { status: status },
                };

                const result = await classCollection.updateOne(filter, updateDoc);
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Error updating class status', error });
            }
        });


        // create or add a class
        app.post('/class', async (req, res) => {
            const item = req.body;
            const result = await classCollection.insertOne(item);
            res.send(result);
        })

        // update class by ID
        app.patch('/update-class/:id', async (req, res) => {
            const id = req.params.id;
            const updatedClass = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = { $set: updatedClass };

            try {
                const result = await classCollection.updateOne(filter, updateDoc);
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to update class' });
            }
        });

        // delete a class
        app.delete('/delete-class/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };

            try {
                const result = await classCollection.deleteOne(filter);
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to delete class' });
            }
        });

        // payment intent
        app.post('/create-payment-intent', async (req, res) => {
            try {
                console.log('Raw price value:', req.body.price);
                const { price } = req.body;
                if (!price || isNaN(price)) {
                    throw new Error('Invalid price value');
                }
                const amount = parseInt(price * 100);
                console.log(amount, 'inside server');
        
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amount,
                    currency: 'usd',
                    payment_method_types: ['card']
                });
        
                res.send({
                    clientSecret: paymentIntent.client_secret
                });
            } catch (error) {
                console.error('Error creating payment intent:', error);
                res.status(500).send({ error: 'Failed to create payment intent' });
            }
        });
        


        // save payment and save enrollment
        app.post('/save-payment', async (req, res) => {
            const { transactionId, email, classId, className, price } = req.body;

            try {
                // Store payment details in a new table or collection
                const paymentInfo = {
                    transactionId,
                    email,
                    classId,
                    className,
                    price,
                    paymentDate: new Date(),
                };
                const paymentResult = await paymentCollection.insertOne(paymentInfo);

                // Update enrollment details
                const enrollmentInfo = {
                    email,
                    classId,
                    enrollmentDate: new Date(),
                };
                const enrollmentResult = await enrollmentCollection.insertOne(enrollmentInfo);

                res.send({
                    success: true,
                    message: "Payment and enrollment information saved successfully.",
                    paymentResult,
                    enrollmentResult,
                });
            } catch (error) {
                res.status(500).send({ success: false, message: "Error saving data.", error });
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