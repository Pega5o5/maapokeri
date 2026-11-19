# Maapokeri – verkkopeli

Suomenkielinen vuoropohjainen nettipeli 2–6 pelaajalle. Jokainen liittyy omalla puhelimellaan pelihuoneeseen. **Palvelin** hallitsee korttipakkaa, vuoroja, 30 sekunnin laskuria ja voittajan laskentaa; pelaajille ei koskaan lähetetä pimeiden korttien todellista sisältöä.

## Käynnistys omalla tietokoneella

Asenna Node.js 20 tai uudempi. Tämä sovellus ei tarvitse ulkopuolisia npm-kirjastoja.

```bash
npm start
```

Avaa selaimessa `http://localhost:3000`. Samassa lähiverkossa olevat puhelimet voivat liittyä tietokoneen LAN-IP:n kautta (`http://192.168.x.x:3000`), jos palomuuri sallii yhteyden. Tämä **ei** vielä anna pääsyä internetin kautta eri verkoista.

Voit käynnistää vaihtoehtoisessa portissa: `PORT=8080 npm start` (Windows PowerShell: `$env:PORT=8080; npm start`).

## Pelaaminen kavereiden kanssa internetissä

Palvelin pitää julkaista internetiin, esimerkiksi Renderin Node Web Service -palveluna tai omalla VPS:llä. Sovelluksessa on mukana `render.yaml` helpottamaan käyttöönottoa.

1. Siirrä kansion sisältö omaan GitHub-repositorioon.
2. Luo Renderiin uusi Web Service / Blueprint GitHub-repositoriosta ja käytä käynnistyskomentoa `npm start` (Node 20+).
3. Avaa Renderin antama HTTPS-osoite puhelimella ja luo huone.
4. Jaa pelin luoma kutsulinkki kavereille. He avaavat linkin ja syöttävät nimensä. Järjestäjä aloittaa pelin.

**Huom.** Jos palvelun ilmainen taso nukuttaa tai käynnistää instanssin uudelleen, huoneet voivat kadota kesken pelin. Tämä versio säilyttää pelit vain palvelimen muistissa. Tuotantokäytössä kannattaa ottaa käyttöön pysyvä tietokanta (esimerkiksi Redis) ja jatkuvasti käynnissä oleva palvelin. Käytä **yhtä palvelininstanssia**, koska nykyiset pelihuoneet eivät synkronoidu eri palvelinprosessien kesken.

## Säännöt

- 52 kortin pakka ja 2 jokeria. Kaikille viisi pimeää korttia. Jakaja aloittaa.
- Vuorolla voi **ottaa avopakan päällimmäisen** ja vaihtaa sen yhteen pimeään korttiin; pimeä kortti menee avopakkaan auki.
- Vaihtoehtoisesti voi **nostaa nostopakasta**, katsoa kortin ja päättää vaihtaa sen pimeään tai laittaa sen avopakkaan ja kääntää oman pimeän kortin.
- **Käännä pimeä** on oikotie nostopakasta nostamiseen ja nostetun hylkäämiseen. Sitten valitaan käännettävä kortti.
- **30 sekuntia per vuoro**, myös valintavaiheissa. Ajan loppuessa palvelin kääntää **vasemmanpuoleisimman pimeän kortin** ja hylkää mahdollisesti nostetun kortin avopakkaan. Jos pelaaja ehti ottaa kortin avopakasta mutta ei vaihtaa sitä, kortti palautetaan avopakkaan ennen uuden kortin nostamista ja hylkäämistä.
- Vuoro siirtyy seuraavalle pelaajalle automaattisesti. Viisi avointa korttia kaikilla päättää pelin.
- Käsien järjestys: hai, pari, neljän suora, neljän väri, kaksi paria, kolmoset, suora, väri, täyskäsi, neloset, värisuora, vitoset. Jokerit ovat villejä.
- Järjestäjä voi päättää jakajan odotushuoneessa. Pelin päätyttyä järjestäjä voi aloittaa uuden jaon samassa huoneessa.

## Tietosuoja ja rajoitukset

- Huoneen koodi toimii kutsuna; oman pelaajan näkymään palataan saman selaimen paikallisesti säilytetyllä satunnaisella tunnuksella.
- Kenenkään pimeitä kortteja, nostopakassa olevia kortteja tai muiden nostamia kortteja ei paljasteta palvelimen API-vastauksissa.
- Pelin osallistujat näkevät kaikkien avatut kortit, omat avoimet korttinsa, nostopakan ja avopakan samalla näytöllä.
- Jos puhelin menettää yhteyden, palvelin jatkaa kelloa; palatessa samaan huoneeseen voi liittyä takaisin samalla selaimella.
- Palvelin ei vaadi henkilötietoja pelaajan nimen lisäksi. Älä käytä oikeaa salasanaa pelaajanimenä.
- Yksittäiset huoneet vanhenevat 24 tunnin käyttämättömyyden jälkeen. Palvelimen uudelleenkäynnistys tyhjentää huoneet.

## Testaus

`npm test` testaa keskeiset palvelinlogiikan ehdot ja 30 sekunnin aikakatkaisun lyhennetyllä testiajalla.
