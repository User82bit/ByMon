import {useEffect,useState} from 'react'
import {MainLayout} from './layout/MainLayout'
import {Home} from './pages/Home/Home'
import {Battle} from './pages/Battle/Battle'
import {enrichPokemonTypes,getPokemonBattleData,getPokemonCatalog} from './services/pokeapi'
import {simulateBattle} from './utils/battle'
import type {BattleResult,PokemonBattleData,PokemonSummary,Team} from './types/pokemon'
import './App.css'

function emptyTeams():Team[]{return[{id:'team-1',name:'Time A',pokemon:[]},{id:'team-2',name:'Time B',pokemon:[]}]}
function createTeam():Team{return{id:'team-'+crypto.randomUUID(),name:'Novo Time',pokemon:[]}}

export default function App(){
 const[screen,setScreen]=useState<'home'|'battle'>('home')
 const[teams,setTeams]=useState<Team[]>(emptyTeams)
 const[catalog,setCatalog]=useState<PokemonSummary[]>([])
 const[loading,setLoading]=useState(true)
 const[error,setError]=useState<string|null>(null)
 const[battleLoading,setBattleLoading]=useState(false)
 const[result,setResult]=useState<BattleResult|null>(null)
 const[details,setDetails]=useState<Map<number,PokemonBattleData>>(new Map())

 async function loadCatalog(){setLoading(true);setError(null);try{const basic=await getPokemonCatalog();setCatalog(basic);setLoading(false);void enrichPokemonTypes(basic,setCatalog)}catch(e){setError(e instanceof Error?e.message:'Erro desconhecido.');setLoading(false)}}
 useEffect(()=>{void loadCatalog()},[])

 function rename(id:string,name:string){setTeams(c=>c.map(t=>t.id===id?{...t,name:name||'Time sem nome'}:t))}
 function addTeam(){setTeams(c=>c.concat(createTeam()))}
 function removeTeam(id:string){if(teams.length>2)setTeams(c=>c.filter(t=>t.id!==id))}
 function addPokemon(id:string,p:PokemonSummary){setTeams(c=>c.map(t=>t.id!==id||t.pokemon.length>=6||t.pokemon.some(x=>x.id===p.id)?t:{...t,pokemon:t.pokemon.concat(p)}))}
 function removePokemon(id:string,pokemonId:number){setTeams(c=>c.map(t=>t.id===id?{...t,pokemon:t.pokemon.filter(p=>p.id!==pokemonId)}:t))}
 function quickAdd(p:PokemonSummary){const t=teams.find(x=>x.pokemon.length<6&&!x.pokemon.some(y=>y.id===p.id));if(t)addPokemon(t.id,p)}

 async function battle(){
  if(!teams.every(t=>t.pokemon.length>0))return
  setBattleLoading(true)
  try{
   const all=teams.flatMap(t=>t.pokemon)
   const data=await Promise.all(all.map(p=>getPokemonBattleData(p)))
   const map=new Map(data.map(p=>[p.id,p]))
   setDetails(map);setResult(simulateBattle(teams,map));setScreen('battle');window.scrollTo({top:0,behavior:'smooth'})
  }catch(e){window.alert(e instanceof Error?e.message:'Não foi possível iniciar a batalha.')}finally{setBattleLoading(false)}
 }
 function reset(){setScreen('home');setTeams(emptyTeams());setResult(null);setDetails(new Map());window.scrollTo({top:0,behavior:'smooth'})}

 return <MainLayout>{screen==='home'?<Home teams={teams} catalog={catalog} loading={loading} error={error} onRenameTeam={rename} onRemoveTeam={removeTeam} onAddTeam={addTeam} onDropPokemon={addPokemon} onRemovePokemon={removePokemon} onRetryCatalog={loadCatalog} onQuickAdd={quickAdd} onBattle={battle} battleLoading={battleLoading}/>:result?<Battle result={result} teams={teams} details={details} onReturn={reset}/>:null}</MainLayout>
}