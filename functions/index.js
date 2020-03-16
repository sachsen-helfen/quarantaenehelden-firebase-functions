const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(
  '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',
);
const { GeoCollectionReference } = require('geofirestore');

exports.offerHelpCreate = functions.region('europe-west1').firestore.document('/ask-for-help/{requestId}/offer-help/{offerId}')
  .onCreate(async (snap, context) => {
    try {
      const parentPath = snap.ref.parent.path; // get the id
      const offerId = snap.id; // get the id
      const db = admin.firestore();
      const askForHelp = snap.ref.parent.parent;

      const offer = await db.collection(parentPath).doc(offerId).get();
      const askRecord = await askForHelp.get();
      const { request, uid } = askRecord.data().d; // TODO check for d
      const data = await admin.auth().getUser(uid);
      const { email: receiver } = data.toJSON();
      const { answer, email } = offer.data();

      console.log({
        to: receiver,
        from: email,
        templateId: 'd-ed9746e4ff064676b7df121c81037fab',
        dynamic_template_data: {
          subject: 'QuarantäneHelden - Jemand hat dir geschrieben!',
          answer,
          email,
          request,
        },
      });
      await sgMail.send({
        to: receiver,
        from: 'help@quarantaenehelden.org',
        replyTo: {
          email: email,
        },
        templateId: 'd-ed9746e4ff064676b7df121c81037fab',
        dynamic_template_data: {
          subject: 'QuarantäneHelden - Jemand hat dir geschrieben!',
          answer,
          email,
          request,
        },
      });
      await db.collection(`/ask-for-help/${askRecord.id}/stats`).doc('external').set({
        responses: admin.firestore.FieldValue.increment(1),
      });
      await db.collection('/stats').doc('external').update({
        offerHelp: admin.firestore.FieldValue.increment(1),
      });
    } catch (e) {
      console.error(e);
      console.log('ID', snap.id);
    }
  });

exports.askForHelpCreate = functions.region('europe-west1').firestore.document('/ask-for-help/{requestId}')
  .onCreate(async (snap, context) => {
    try {
      const MAPS_ENABLED = false;
      const parentPath = snap.ref.parent.path; // get the id
      const askForHelpId = snap.id; // get the id
      const db = admin.firestore();

      const askForHelpSnap = await db.collection(parentPath).doc(askForHelpId).get();
      const askForHelpSnapData = askForHelpSnap.data();

      // Create a GeoCollection reference
      let queryResult = [];
      if (MAPS_ENABLED) {
        const offersRef = new GeoCollectionReference(db.collection('offer-help'));
        const query = offersRef.near({ center: askForHelpSnapData.coordinates, radius: 30 });
        queryResult = (await query.get()).docs.map(doc => doc.data());

      } else {
        const offersRef = db.collection('offer-help');
        if (!askForHelpSnapData || !askForHelpSnapData.d || !askForHelpSnapData.d.plz) {
          console.warn('Failed to find plz for ask-for-help ', askForHelpSnapData);
        } else {
          const start = askForHelpSnapData.d.plz.slice(0, -3) + '000';
          const end = askForHelpSnapData.d.plz.slice(0, -3) + '999';
          const results = await offersRef.orderBy('d.plz').startAt(start).endAt(end).get();
          queryResult = results.docs.map(doc => ({ id: doc.id, ...doc.data().d }));
        }
      }
      let offersToContact = [];
      if (queryResult.length > 30) {
        for (let i = queryResult.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * i);
          const temp = queryResult[i];
          queryResult[i] = queryResult[j];
          queryResult[j] = temp;
        }
        offersToContact = queryResult.slice(0, 30);
      } else {
        offersToContact = queryResult;
      }

      await Promise.all(offersToContact.map(async offerDoc => {
        try {
          const { uid } = offerDoc;
          const offeringUser = await admin.auth().getUser(uid);
          const { email } = offeringUser.toJSON();
          return await sgMail.send({
            to: email,
            from: 'help@quarantaenehelden.org',
            templateId: 'd-9e0d0ec8eda04c9a98e6cb1edffdac71',
            dynamic_template_data: {
              subject: 'QuarantäneHelden - Jemand braucht deine Hilfe!',
              request: askForHelpSnapData.d.request,
              location: askForHelpSnapData.d.location,
              link: 'https://www.quarantaenehelden.org/#/offer-help/' + askForHelpId,
            },
          });
        } catch (err) {
          console.warn(err);
        }
      }));

      await db.collection('/stats').doc('external').update({
        askForHelp: admin.firestore.FieldValue.increment(1),
      });
    } catch (e) {
      console.error(e);
      console.log('ID', snap.id);
    }
  });
