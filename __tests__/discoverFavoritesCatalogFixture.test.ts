const smoke=require('../scripts/backend/discover-favorites-staging-smoke.cjs');
const valid={id:'p',provider:'defacto',external_id:'1',title:'Product',brand:'Brand',price:12.5,currency:'TRY',
  image_url:'https://example.invalid/p.jpg',product_url:'https://example.invalid/p',category:'upper_body',affiliate_url:null};
function backend(data:any[]) {
  const ranges:any[]=[];const client={from:()=>{
    const q:any={select:()=>q,order:()=>q,limit:async(n:number)=>({data:data.slice(0,n),error:null}),
      range:async(start:number,end:number)=>{ranges.push([start,end]);return {data:data.slice(start,end+1),count:data.length,error:null};}};return q;
  }};return {client,ranges};
}
test('valid candidate outside first 40 is found using bounded pages',async()=>{
  const rows=Array.from({length:85},(_,i)=>({...valid,id:String(i),image_url:'file://local'}));rows.push({...valid,id:'last'});
  const b=backend(rows),emit=jest.fn();const candidates=await smoke.port(b.client,'a','b',emit).catalog();
  expect(candidates.map((p:any)=>p.id)).toEqual(['last']);expect(b.ranges.length).toBeGreaterThan(1);
});
test('uses the application gallery-first image and normalized numeric price',async()=>{
  const b=backend([{...valid,price:'12,50',image_url:'file://old',images:['', 'https://example.invalid/gallery.jpg']}]);
  const candidates=await smoke.port(b.client,'a','b').catalog();
  expect(candidates[0]).toMatchObject({price:12.5,imageUrl:'https://example.invalid/gallery.jpg'});
});
test('invalid price, image, category and required shape never become fixtures',async()=>{
  const b=backend([{...valid,price:null},{...valid,price:'garbage'},{...valid,price:'bad12text'},
    {...valid,price:''},{...valid,price:true},{...valid,price:-1},{...valid,image_url:'https://'},
    {...valid,category:'unknown'},{...valid,currency:null}]);
  expect(await smoke.port(b.client,'a','b').catalog()).toEqual([]);
});
test('search has a finite cap and emits only anonymous rejection counts',async()=>{
  const b=backend(Array.from({length:2000},(_,i)=>({...valid,id:'private-product-'+i,image_url:'file://private'})));
  const emit=jest.fn();expect(await smoke.port(b.client,'a','b',emit).catalog()).toEqual([]);
  expect(b.ranges).toHaveLength(10);expect(b.ranges.every(([a,z])=>z-a+1===80)).toBe(true);
  expect(emit.mock.calls.flat().join(' ')).not.toMatch(/private|product-|file:/);
  expect(emit.mock.calls.flat().join(' ')).toContain('"limitReached":true');
});
