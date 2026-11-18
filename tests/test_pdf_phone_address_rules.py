"""Cross-engine parity for browser sanitization and optional PDF CLI."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'tools'))
from pdf_rules import detect, DETECTORS

class TestPhoneAddressOffsets(unittest.TestCase):
    def test_new_categories(self):
        self.assertIn('phones',DETECTORS)
        self.assertIn('addresses',DETECTORS)
        cases={
            'Telefone: (48) 3333-4444':'(48) 3333-4444',
            'Celular: 48988887777':'48988887777',
            'Telefone: +55 (48) 98888-7777':'+55 (48) 98888-7777',
            '0800 123 4567':'0800 123 4567',
            'Rua das Flores, 123, Centro - Florianópolis/SC':'Rua das Flores, 123, Centro - Florianópolis/SC',
            'Endereço: Av. do Sol, 555, apto 201':'Av. do Sol, 555, apto 201',
            'CEP: 88100000':'88100000',
            'CEP 88100-000':'88100-000',
        }
        for source,secret in cases.items():
            with self.subTest(source=source):
                marked=[source[h.start:h.end] for h in detect(source)]
                self.assertIn(secret,marked)
    def test_negative_and_switches(self):
        for s in ['Avenida Brasil','Endereço: não informado','Código: 88100000']:
            self.assertFalse(detect(s),s)
        self.assertFalse(detect('Rua das Flores, 123',{'addresses':False}))
        self.assertFalse(detect('(48) 3333-4444',{'phones':False}))
    def test_cpf_not_phone(self):
        s='CPF: 11999999999'
        self.assertEqual([h.category for h in detect(s)],['CPF / 11 dígitos'])
        s='Celular: 48988887777'
        self.assertEqual([h.category for h in detect(s)],['Telefone'])
