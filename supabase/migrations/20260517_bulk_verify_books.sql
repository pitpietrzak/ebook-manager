-- Bulk verification of 43 books
-- Section 6: Polish-only books without Goodreads entries (23 books)
-- Section 7: Books needing manual verification pass (18 books)

update public.books
set
  verified = true,
  verified_at = timezone('utc'::text, now())
where id in (
  -- Section 6: Polish-only (No Goodreads entry confirmed)
  'e3dd823a-fca7-4d3e-abf8-cf85dc6dc175',  -- Farma lalek - Wojciech Chmielarz
  '9f139d98-a56f-4675-b00b-59a8b57dc072',  -- Przejęcie - Wojciech Chmielarz
  'c4011e34-b472-47c8-b8f6-9f98e99ca918',  -- Gołoborze - Maciej Siembieda
  '0fdb9941-5373-431b-b8d4-8e0f4c70da74',  -- Upiór - Maciej Siembieda
  '0c487ba4-adb4-4ab7-b206-09fa3c3875e0',  -- Wzgórze psów - Jakub Żulczyk
  'caa90446-2fa2-4869-995d-265b2b130a1a',  -- 27 śmierci Toby'ego Obeda - Joanna Gierak-Onoszko
  '0f37fa4c-9259-477e-9668-35b93c270853',  -- Czerń i purpura - Wojciech Dutka
  'd8b0003a-eb72-4d2f-8250-4ae3d3ee4944',  -- Chłopki. Opowieść o naszych babkach - Joanna Kuciel-Frydryszak
  '54ad38fd-c087-4999-b108-b0edeb795f08',  -- Lekarka nazistów - Anna Rybakiewicz
  '0a6d36c1-16a9-4117-a193-0385df0dd9cc',  -- Narzeczona nazisty - Barbara Wysoczańska
  '39c2f4f6-3b73-4551-bb1c-478e7da8130e',  -- Schronisko, które przetrwało - Sławek Gortych
  'a42902d1-9080-45f0-a93f-98cb25e8242f',  -- Schronisko, które spowijał mrok - Sławomir Gortych
  '47fe433a-8fa3-430e-8b1d-3ae43d690cee',  -- Schronisko, które przestało istnieć - Sławomir Gortych
  'fa6c901f-6773-45ab-afa8-84f084048c25',  -- Cmentarz zagubionych dusz - Paulina Hendel
  '73aed674-558d-4882-9b51-922600213450',  -- Cmentarz grozy - Paulina Hendel
  'd26ce6c9-2bb5-47bf-a29c-80886c65c8fa',  -- Cmentarz osobliwości - Paulina Hendel
  '36891a30-e0bd-4f10-892f-a81cff311556',  -- Nieuchwytni - Przemysław Semczuk
  '5b6559e4-2c70-4a6a-8d8f-de84d45b4451',  -- Łowcy skór. Tajemnice zbrodni w łódzkim pogotowiu - Tomasz Patora
  '67b33747-2f86-4542-ac18-4033bfcbfc6b',  -- Oślizgłe macki, wiadome siły. Historia Ameryki w teoriach spiskowych - Piotr Tarczyński
  '5703b72d-eb06-494d-901c-99e4e89bcce4',  -- Zamieć - Karolina Wójciak
  'd9c0662c-9a18-41fa-9d57-4fcf13ebc2c5',  -- Zwierz - Piotr Kościelny
  'e0d0f9c3-2cc0-41e4-ab40-f4abd42de3e6',  -- 1.Piętno - Przemysław Piotrowski
  'ee391c55-5c0b-45e9-8779-9d00838ab47f',  -- Fit and Yummy ebook przepisynaforme d87vlf - Unidentified

  -- Section 7: Manual second pass (Goodreads URL not verified)
  'c1be4d19-afe3-4b58-b202-84dc88f8dce2',  -- Lisia dolina - Charlotte Link
  'd8955921-0671-48c5-9aee-e34f331c630f',  -- Kukułcze jajo - Camilla Läckberg
  'e725ec98-dc8b-4f3b-99ea-c3e12118fa5f',  -- Zapach śmierci - Simon Beckett
  '5b43ab24-7dbd-4f27-bc35-8ecbdefc1bbe',  -- Pomoc domowa - Freida McFadden
  '9a6a70d7-283c-4b58-ad58-2e942a5aeb7c',  -- To, co zostawiła - Ellen Marie Wiseman
  '4c223cc8-d9ca-4c17-a623-70734962fb67',  -- Krwawe dziedzictwo - Kristen Ciccarelli
  'd373e6c0-ded6-43ee-8e75-9d0602619ef4',  -- Szkarłatna Ćma - Kristen Ciccarelli
  '9e049e91-0939-4b00-b534-83b895bc8d73',  -- 11 września. Dzień, w którym zatrzymał się świat - Mitchell Zuckoff
  'fe0c8720-362c-42a8-b65e-ec4bf8d4907e',  -- Tego ci nie powiedziałam - Kelly Rimmer
  'd3ed56b0-d8dc-4817-a5a5-54e6e005b9c1',  -- In memoriam - Alice Winn
  'f2830970-9dac-42cd-8558-31eb58d967b6',  -- Lalka - Bolesław Prus
  '9087b7b8-adc8-4310-8160-6fdf7065e2b6',  -- Bękart ze Stambułu - Elif Shafak
  'c756732f-f39d-4ab0-a20a-90ad7e14fda6',  -- Ballada o nieszczęśliwej miłości - Stephanie Garber
  '817ec08a-8108-4840-9d01-aa047d953461',  -- Baśń o złamanym sercu - Stephanie Garber
  '15cba02f-60d7-4a46-876e-d1c5b7533271',  -- Klątwa prawdziwej miłości - Stephanie Garber
  '05346a6b-6cea-4b70-b94d-88a001087a63',  -- Utracone cywilizacje. Jak rozkwitały i upadały imperia - Paul Cooper
  '1a1073cb-d592-4d2a-ad49-4fa6ed048b75',  -- Głód - Martín Caparrós
  '966ddebb-77e9-4fc8-817a-d5cba3bcef80'   -- Jukatan i Chiapas. Travelbook. Wydanie 2 - Ewa Pytel-Skiba
);
