module.exports = {
    frequency: 10 * 60,
    mail: {
        to: 'bizounours@gmail.com',
        smtp: {
           host: "smtp.gmail.com",
           port: 465,
           user: "bonnenuitlespetits@gmail.com",
           password: "Zzzzz"
        }
    },
    checks: [
        {
            id: 'macron gyneco',
            //alreadySeen: false,
            refuseReplace: true,
            //teleHealth: false,
            //motiveCat: 'election',
            motive: 'Echographie morphologique précoce du 2T-102',
            url: 'https://www.doctolib.fr/gynecologue-obstetricien/neuilly-sur-seine/sabine-macron-neuilly-sur-seine',
            wantedBefore: 14
        },
        {
            id: 'macron psy',
            //alreadySeen: false,
            refuseReplace: true,
            //teleHealth: false,
            //motiveCat: 'election',
            motive: 'Première consultation de psychologie-14',
            url: 'https://www.doctolib.fr/psychologue/marcq-en-baroeul/valerie-carre',
            wantedBefore: 21
        },
    ]
};
