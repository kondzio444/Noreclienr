//! Uncompressed NBT as Minecraft writes servers.dat (port of the reader/writer in official.js).
//! Every tag is kept exactly, so a file read and written again is byte-identical.

use crate::error::{msg, Result};

pub const END: u8 = 0;
pub const BYTE: u8 = 1;
pub const SHORT: u8 = 2;
pub const INT: u8 = 3;
pub const LONG: u8 = 4;
pub const FLOAT: u8 = 5;
pub const DOUBLE: u8 = 6;
pub const BYTE_ARRAY: u8 = 7;
pub const STRING: u8 = 8;
pub const LIST: u8 = 9;
pub const COMPOUND: u8 = 10;
pub const INT_ARRAY: u8 = 11;
pub const LONG_ARRAY: u8 = 12;

#[derive(Clone, Debug, PartialEq)]
pub enum Tag {
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(f32),
    Double(f64),
    ByteArray(Vec<u8>),
    String(String),
    /// element type + items (the type is kept for empty lists)
    List(u8, Vec<Tag>),
    Compound(Compound),
    IntArray(Vec<i32>),
    LongArray(Vec<i64>),
}

/// Named entries in file order.
pub type Compound = Vec<(String, Tag)>;

impl Tag {
    pub fn id(&self) -> u8 {
        match self {
            Tag::Byte(_) => BYTE,
            Tag::Short(_) => SHORT,
            Tag::Int(_) => INT,
            Tag::Long(_) => LONG,
            Tag::Float(_) => FLOAT,
            Tag::Double(_) => DOUBLE,
            Tag::ByteArray(_) => BYTE_ARRAY,
            Tag::String(_) => STRING,
            Tag::List(..) => LIST,
            Tag::Compound(_) => COMPOUND,
            Tag::IntArray(_) => INT_ARRAY,
            Tag::LongArray(_) => LONG_ARRAY,
        }
    }
}

/// Field of a compound by name.
pub fn field<'a>(c: &'a Compound, name: &str) -> Option<&'a Tag> {
    c.iter().find(|(n, _)| n == name).map(|(_, t)| t)
}

pub fn field_mut<'a>(c: &'a mut Compound, name: &str) -> Option<&'a mut Tag> {
    c.iter_mut().find(|(n, _)| n == name).map(|(_, t)| t)
}

struct Reader<'a> {
    buf: &'a [u8],
    o: usize,
}

impl Reader<'_> {
    fn take(&mut self, n: usize) -> Result<&[u8]> {
        let end = self.o.checked_add(n).filter(|e| *e <= self.buf.len()).ok_or_else(|| msg("servers.dat: plik jest ucięty"))?;
        let s = &self.buf[self.o..end];
        self.o = end;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn arr<const N: usize>(&mut self) -> Result<[u8; N]> {
        Ok(self.take(N)?.try_into().expect("length checked"))
    }
    fn len(&mut self) -> Result<usize> {
        let n = i32::from_be_bytes(self.arr()?);
        usize::try_from(n).map_err(|_| msg("servers.dat: ujemna długość"))
    }
    fn string(&mut self) -> Result<String> {
        let n = u16::from_be_bytes(self.arr()?) as usize;
        Ok(String::from_utf8_lossy(self.take(n)?).into_owned())
    }
    fn payload(&mut self, t: u8, depth: usize) -> Result<Tag> {
        if depth > 512 {
            return Err(msg("servers.dat: za głęboko zagnieżdżone dane"));
        }
        Ok(match t {
            BYTE => Tag::Byte(self.u8()? as i8),
            SHORT => Tag::Short(i16::from_be_bytes(self.arr()?)),
            INT => Tag::Int(i32::from_be_bytes(self.arr()?)),
            LONG => Tag::Long(i64::from_be_bytes(self.arr()?)),
            FLOAT => Tag::Float(f32::from_be_bytes(self.arr()?)),
            DOUBLE => Tag::Double(f64::from_be_bytes(self.arr()?)),
            BYTE_ARRAY => {
                let n = self.len()?;
                Tag::ByteArray(self.take(n)?.to_vec())
            }
            STRING => Tag::String(self.string()?),
            LIST => {
                let et = self.u8()?;
                let n = self.len()?;
                let mut items = Vec::with_capacity(n.min(4096));
                for _ in 0..n {
                    items.push(self.payload(et, depth + 1)?);
                }
                Tag::List(et, items)
            }
            COMPOUND => {
                let mut entries = Vec::new();
                loop {
                    let t = self.u8()?;
                    if t == END {
                        break;
                    }
                    let name = self.string()?;
                    entries.push((name, self.payload(t, depth + 1)?));
                }
                Tag::Compound(entries)
            }
            INT_ARRAY => {
                let n = self.len()?;
                (0..n).map(|_| self.arr().map(i32::from_be_bytes)).collect::<Result<_>>().map(Tag::IntArray)?
            }
            LONG_ARRAY => {
                let n = self.len()?;
                (0..n).map(|_| self.arr().map(i64::from_be_bytes)).collect::<Result<_>>().map(Tag::LongArray)?
            }
            other => return Err(msg(format!("Nieznany typ NBT {other}"))),
        })
    }
}

/// Reads a whole NBT file: (root name, root compound).
pub fn read(buf: &[u8]) -> Result<(String, Compound)> {
    let mut r = Reader { buf, o: 0 };
    if r.u8()? != COMPOUND {
        return Err(msg("servers.dat: zły format"));
    }
    let name = r.string()?;
    match r.payload(COMPOUND, 0)? {
        Tag::Compound(c) => Ok((name, c)),
        _ => unreachable!("compound payload"),
    }
}

fn write_string(out: &mut Vec<u8>, s: &str) {
    let b = s.as_bytes();
    out.extend_from_slice(&(b.len().min(u16::MAX as usize) as u16).to_be_bytes());
    out.extend_from_slice(&b[..b.len().min(u16::MAX as usize)]);
}

fn write_payload(out: &mut Vec<u8>, t: &Tag) {
    match t {
        Tag::Byte(v) => out.push(*v as u8),
        Tag::Short(v) => out.extend_from_slice(&v.to_be_bytes()),
        Tag::Int(v) => out.extend_from_slice(&v.to_be_bytes()),
        Tag::Long(v) => out.extend_from_slice(&v.to_be_bytes()),
        Tag::Float(v) => out.extend_from_slice(&v.to_be_bytes()),
        Tag::Double(v) => out.extend_from_slice(&v.to_be_bytes()),
        Tag::ByteArray(v) => {
            out.extend_from_slice(&(v.len() as i32).to_be_bytes());
            out.extend_from_slice(v);
        }
        Tag::String(s) => write_string(out, s),
        Tag::List(et, items) => {
            out.push(*et);
            out.extend_from_slice(&(items.len() as i32).to_be_bytes());
            for i in items {
                write_payload(out, i);
            }
        }
        Tag::Compound(c) => {
            for (name, v) in c {
                out.push(v.id());
                write_string(out, name);
                write_payload(out, v);
            }
            out.push(END);
        }
        Tag::IntArray(v) => {
            out.extend_from_slice(&(v.len() as i32).to_be_bytes());
            for x in v {
                out.extend_from_slice(&x.to_be_bytes());
            }
        }
        Tag::LongArray(v) => {
            out.extend_from_slice(&(v.len() as i32).to_be_bytes());
            for x in v {
                out.extend_from_slice(&x.to_be_bytes());
            }
        }
    }
}

pub fn write(name: &str, root: &Compound) -> Vec<u8> {
    let mut out = vec![COMPOUND];
    write_string(&mut out, name);
    write_payload(&mut out, &Tag::Compound(root.clone()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_keeps_every_tag() {
        let root: Compound = vec![
            (
                "servers".into(),
                Tag::List(
                    COMPOUND,
                    vec![Tag::Compound(vec![
                        ("name".into(), Tag::String("Mój serwer".into())),
                        ("ip".into(), Tag::String("a.pl".into())),
                        ("acceptTextures".into(), Tag::Byte(1)),
                    ])],
                ),
            ),
            ("x".into(), Tag::Long(5)),
            ("f".into(), Tag::Float(1.5)),
            ("d".into(), Tag::Double(-2.25)),
            ("s".into(), Tag::Short(-3)),
            ("i".into(), Tag::Int(70000)),
            ("ba".into(), Tag::ByteArray(vec![1, 2, 255])),
            ("ia".into(), Tag::IntArray(vec![1, -1])),
            ("la".into(), Tag::LongArray(vec![i64::MAX])),
            ("empty".into(), Tag::List(END, vec![])),
        ];
        let buf = write("", &root);
        let (name, back) = read(&buf).unwrap();
        assert_eq!(name, "");
        assert_eq!(back, root);
        assert_eq!(write(&name, &back), buf);
    }

    #[test]
    fn broken_input_is_an_error() {
        assert!(read(&[1, 2, 3]).is_err());
        assert!(read(&[10, 0, 0, 9, 0, 1, b'x']).is_err());
        assert!(read(&[]).is_err());
    }
}
